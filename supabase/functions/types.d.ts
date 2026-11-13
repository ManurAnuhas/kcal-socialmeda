// Ambient type declarations for Deno runtime and HTTPS module imports in Supabase Edge Functions
declare module "https://*" {
  const value: any;
  export default value;
  export const createClient: any;
  export const [key: string]: any;
}

declare namespace Deno {
  export interface Env {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
    has(key: string): boolean;
  }
  export const env: Env;
  export function serve(handler: (req: Request) => Response | Promise<Response>): void;
}

