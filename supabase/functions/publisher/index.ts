// Publishes due posts to Instagram and Facebook Page via the Meta Graph API.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const G = "https://graph.facebook.com/v21.0";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(path: string, body: Record<string, string>) {
  const r = await fetch(`${G}/${path}`, { method: "POST", body: new URLSearchParams(body) });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error?.message || "Graph API error");
  return j;
}

async function ig(a: any, p: any) {
  const { token, ext_id: id } = a;
  const m = p.media || {};
  if (!token) throw new Error("Missing Meta Access Token");
  if (!id) throw new Error("Missing Instagram Account / Page ID");

  const waitContainer = async (cid: string) => {
    for (let i = 0; i < 30; i++) {
      const r = await fetch(`${G}/${cid}?fields=status_code&access_token=${encodeURIComponent(token)}`);
      const s = await r.json();
      if (s.status_code === "FINISHED") return;
      if (s.status_code === "ERROR") throw new Error("Instagram could not process media asset");
      await sleep(3000);
    }
    throw new Error("Instagram media processing timed out");
  };

  // Carousel or Single Post (Photos)
  if (m.post && m.post.length > 0) {
    let creationId: string;
    if (m.post.length === 1) {
      const c = await post(`${id}/media`, {
        image_url: m.post[0],
        caption: p.caption || "",
        access_token: token
      });
      creationId = c.id;
    } else {
      const kids: string[] = [];
      for (const u of m.post.slice(0, 10)) {
        const item = await post(`${id}/media`, {
          image_url: u,
          is_carousel_item: "true",
          access_token: token
        });
        kids.push(item.id);
      }
      const c = await post(`${id}/media`, {
        media_type: "CAROUSEL",
        children: kids.join(","),
        caption: p.caption || "",
        access_token: token
      });
      creationId = c.id;
    }
    await post(`${id}/media_publish`, { creation_id: creationId, access_token: token });
  }

  // Reel (Video)
  if (m.reel) {
    const b: Record<string, string> = {
      media_type: "REELS",
      video_url: m.reel,
      caption: p.caption || "",
      access_token: token
    };
    if (m.cover) b.cover_url = m.cover;
    const c = await post(`${id}/media`, b);
    await waitContainer(c.id);
    await post(`${id}/media_publish`, { creation_id: c.id, access_token: token });
  }
}

async function fb(a: any, p: any) {
  const { token, ext_id: id } = a;
  const m = p.media || {};
  if (!token) throw new Error("Missing Facebook Page Access Token");
  if (!id) throw new Error("Missing Facebook Page ID");

  if (m.post && m.post.length > 0) {
    if (m.post.length === 1) {
      await post(`${id}/photos`, {
        url: m.post[0],
        caption: p.caption || "",
        access_token: token
      });
    } else {
      const ids: string[] = [];
      for (const u of m.post) {
        const photoRes = await post(`${id}/photos`, { url: u, published: "false", access_token: token });
        ids.push(photoRes.id);
      }
      const b: Record<string, string> = { message: p.caption || "", access_token: token };
      ids.forEach((x, i) => (b[`attached_media[${i}]`] = JSON.stringify({ media_fbid: x })));
      await post(`${id}/feed`, b);
    }
  }

  if (m.reel) {
    await post(`${id}/videos`, {
      file_url: m.reel,
      description: p.caption || "",
      access_token: token
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Look for posts scheduled up to 1 minute into the future to account for client/server clock difference
  const threshold = new Date(Date.now() + 60000).toISOString();
  const { data: due, error: dueError } = await db
    .from("posts")
    .select("*")
    .eq("status", "scheduled")
    .lte("scheduled_at", threshold)
    .order("scheduled_at", { ascending: true })
    .limit(5);

  if (dueError) {
    return new Response(JSON.stringify({ error: dueError.message }), { status: 500, headers: cors });
  }

  for (const p of due ?? []) {
    // Atomically claim the post so concurrent workers won't double publish
    const { data: claimed } = await db
      .from("posts")
      .update({ status: "publishing" })
      .eq("id", p.id)
      .eq("status", "scheduled")
      .select();

    if (!claimed?.length) continue;

    const { data: accs } = await db.from("account_secrets").select("*");
    const errs: string[] = [];
    let ok = 0;

    for (const pl of p.platforms as string[]) {
      try {
        const a = accs?.find((x: any) => x.platform === pl);
        if (!a || !a.token) {
          throw new Error("Account token not configured");
        }
        if (pl === "ig") await ig(a, p);
        else if (pl === "fb") await fb(a, p);
        else if (pl === "wa") {
          // WhatsApp Channels have no direct public API, marked as ready for manual share
          ok++;
        } else {
          throw new Error("Direct publishing not supported for this platform; please post manually");
        }
        ok++;
      } catch (e) {
        errs.push(`${pl.toUpperCase()}: ${(e as Error).message}`);
      }
    }

    const finalStatus = ok > 0 ? "published" : "failed";
    const errorMessage = errs.length > 0 ? errs.join(" | ") : null;

    await db.from("posts").update({ status: finalStatus, error: errorMessage }).eq("id", p.id);
  }

  return new Response(JSON.stringify({ ok: true, processed: due?.length || 0 }), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" }
  });
});
