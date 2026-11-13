// Admin-only actions. Verifies the caller's JWT and that they are an active admin, then uses the service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const PLATFORMS = ["ig", "fb", "tt", "yt", "wa"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: u } = await svc.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await svc.from("profiles").select("role,active").eq("user_id", u.user.id).single();
    if (!me?.active || me.role !== "admin") return json({ error: "Admins only" }, 403);
    const b = await req.json();
    const log = (action: string, detail: string) => svc.from("audit_log").insert({ user_id: u.user.id, email: u.user.email, action, detail });

    switch (b.action) {
      case "invite": {
        const email = String(b.email || "").trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Invalid email address" }, 400);
        const role = b.role === "admin" ? "admin" : "editor";
        const { data, error } = await svc.auth.admin.inviteUserByEmail(email);
        if (error) {
          // If already registered, update their profile role instead of hard failing
          const { data: existingUsers } = await svc.auth.admin.listUsers();
          const target = existingUsers?.users?.find((x) => x.email?.toLowerCase() === email);
          if (target) {
            await svc.from("profiles").upsert({ user_id: target.id, email, role, active: true });
            await log("update user", `${email} role set to ${role}`);
            return json({ ok: true, notice: "User already registered; updated access role." });
          }
          return json({ error: error.message }, 400);
        }
        await svc.from("profiles").upsert({ user_id: data.user.id, email, role, active: true });
        await log("invite", `${email} as ${role}`);
        return json({ ok: true });
      }
      case "setRole": {
        if (b.user_id === u.user.id) return json({ error: "You cannot change your own role" }, 400);
        const role = b.role === "admin" ? "admin" : "editor";
        await svc.from("profiles").update({ role }).eq("user_id", b.user_id);
        await log("role change", `User ${b.user_id} set to ${role}`);
        return json({ ok: true });
      }
      case "setActive": {
        if (b.user_id === u.user.id) return json({ error: "You cannot disable your own admin account" }, 400);
        const active = !!b.active;
        await svc.from("profiles").update({ active }).eq("user_id", b.user_id);
        await svc.auth.admin.updateUserById(b.user_id, { ban_duration: active ? "none" : "876000h" });
        await log(active ? "enable user" : "disable user", `User ${b.user_id}`);
        return json({ ok: true });
      }
      case "saveAccount": {
        if (!PLATFORMS.includes(b.platform)) return json({ error: "Unsupported social platform" }, 400);
        const handle = String(b.handle || "").trim().slice(0, 80);
        await svc.from("accounts").upsert({ platform: b.platform, handle });
        if (b.token || b.ext_id) {
          await svc.from("account_secrets").upsert({
            platform: b.platform,
            token: b.token ? String(b.token).trim() : null,
            ext_id: b.ext_id ? String(b.ext_id).trim() : null
          });
        }
        await log("connect account", `${b.platform} (${handle})`);
        return json({ ok: true });
      }
      case "removeAccount": {
        if (!PLATFORMS.includes(b.platform)) return json({ error: "Unsupported social platform" }, 400);
        await svc.from("accounts").delete().eq("platform", b.platform);
        await log("disconnect account", b.platform);
        return json({ ok: true });
      }
      case "checkSecrets": {
        // Safe check for admins: returns token status without exposing secret values
        const { data: sec } = await svc.from("account_secrets").select("platform,ext_id,token");
        const status: Record<string, { connected: boolean; hasToken: boolean; ext_id: string | null }> = {};
        for (const p of PLATFORMS) {
          const item = sec?.find((x) => x.platform === p);
          status[p] = {
            connected: !!item,
            hasToken: !!(item?.token && item.token.length > 5),
            ext_id: item?.ext_id || null
          };
        }
        return json({ status });
      }
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
