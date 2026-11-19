declare const EdgeRuntime: { waitUntil?: (promise: Promise<unknown>) => void };

import { withSupabase } from "npm:@supabase/server@1";

const ALLOWED_ORIGINS = [
  "https://syednasrulla.github.io",
  "http://localhost:8000",
  "http://localhost:5500",
];

const ALLOWED_HOSTNAMES = [
  "syednasrulla.github.io",
  "localhost",
];

const ALLOWED_FIELDS = [
  "Useful Contact Info",
  "Site Info / Notes",
  "Site Address",
  "Site Special Instructions",
];

const MAX_BODY_BYTES = 160000;

function respond(
  data: unknown,
  status = 200,
  origin?: string | null,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "content-type, apikey, authorization, x-client-info",
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return new Response(JSON.stringify(data), { status, headers });
}

function validText(value: unknown, min: number, max: number) {
  return typeof value === "string" &&
    value.trim().length >= min &&
    value.trim().length <= max;
}

// Notification delivery is server-only. No API key or recipient list in public JS.
// Recipients are derived from the same app_roles.admin table as admin.html.
async function notifyAdministrators(
  admin: any,
  details: { site_code: string; carrier: string; technician_name: string; fields: string[]; submission_id: unknown },
) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("AZM_NOTIFICATION_FROM");
  if (!apiKey || !from) {
    console.warn("Admin email notifications not configured");
    return;
  }
  const { data: roles, error: roleError } = await admin
    .from("app_roles").select("user_id").eq("role", "admin");
  if (roleError) throw roleError;
  const adminIds = new Set((roles || []).map((r: {user_id:string}) => r.user_id));
  if (!adminIds.size) return;
  const recipients = new Set<string>();
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const users = data?.users || [];
    for (const user of users) {
      if (adminIds.has(user.id) && user.email && !user.banned_until)
        recipients.add(user.email);
    }
    if (users.length < 100 || recipients.size === adminIds.size) break;
  }
  if (!recipients.size) return;
  const emails = [...recipients];
  const safe = (v: unknown) => String(v ?? "").replace(/[\r\n]+/g, " ").slice(0, 240);
  const message = [
    "A new site improvement request needs review.",
    "",
    "Site: " + safe(details.site_code),
    "Carrier: " + safe(details.carrier),
    "Submitted by: " + safe(details.technician_name),
    "Fields: " + details.fields.map(safe).join(", "),
    "Submission ID: " + safe(details.submission_id),
    "",
    "Review: https://syednasrulla.github.io/azimuth-site-directory/admin.html",
  ].join("\n");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [emails[0]],
      ...(emails.length > 1 ? { bcc: emails.slice(1) } : {}),
      subject: `AZM Site Directory: new update for ${safe(details.site_code)}`,
      text: message,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("Email provider returned HTTP " + response.status);
}

export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    const origin = req.headers.get("origin");

    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return respond({ error: "Origin not allowed" }, 403, origin);
    }

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "content-type, apikey, authorization, x-client-info",
          "Vary": "Origin",
        },
      });
    }

    if (req.method !== "POST") {
      return respond({ error: "Method not allowed" }, 405, origin);
    }

    if (
      !req.headers.get("content-type")
        ?.toLowerCase()
        .startsWith("application/json")
    ) {
      return respond({ error: "JSON required" }, 415, origin);
    }

    const secret = Deno.env.get("TURNSTILE_SECRET_KEY");

    if (!secret) {
      console.error("Turnstile secret is missing");
      return respond({ error: "Service unavailable" }, 503, origin);
    }

    let body: Record<string, unknown>;

    try {
      const declaredLength = Number(
        req.headers.get("content-length") || "0"
      );

      if (declaredLength > MAX_BODY_BYTES) {
        return respond({ error: "Request too large" }, 413, origin);
      }

      const raw = await req.text();

      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
        return respond({ error: "Request too large" }, 413, origin);
      }

      const parsed = JSON.parse(raw);

      if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        return respond({ error: "Invalid request" }, 400, origin);
      }

      body = parsed;
    } catch {
      return respond({ error: "Invalid JSON" }, 400, origin);
    }

    const {
      technician_name,
      carrier,
      province,
      site_code,
      changes,
      turnstile_token,
    } = body;

    if (
      !validText(technician_name, 2, 120) ||
      !["TELUS", "Rogers"].includes(String(carrier)) ||
      !["BC", "AB", "SK"].includes(String(province)) ||
      !validText(site_code, 2, 40) ||
      !/^[A-Za-z0-9_-]{2,40}$/.test(String(site_code))
    ) {
      return respond(
        { error: "Invalid submission details" },
        400,
        origin
      );
    }

    if (
      !Array.isArray(changes) ||
      changes.length < 1 ||
      changes.length > 30
    ) {
      return respond(
        { error: "Submit between 1 and 30 changes" },
        400,
        origin
      );
    }

    const validatedChanges = [];

    for (const change of changes) {
      if (
        !change ||
        typeof change !== "object" ||
        Array.isArray(change)
      ) {
        return respond(
          { error: "Invalid change" },
          400,
          origin
        );
      }

      const {
        field_name,
        action,
        original_value,
        proposed_value,
        reason,
      } = change;

      if (
        !ALLOWED_FIELDS.includes(String(field_name)) ||
        !["add", "replace", "remove"].includes(String(action))
      ) {
        return respond(
          { error: "Unsupported change" },
          400,
          origin
        );
      }

      if (
        original_value != null &&
        !validText(original_value, 1, 5000)
      ) {
        return respond(
          { error: "Invalid original value" },
          400,
          origin
        );
      }

      if (
        proposed_value != null &&
        !validText(proposed_value, 1, 5000)
      ) {
        return respond(
          { error: "Invalid proposed value" },
          400,
          origin
        );
      }

      if (
        (action === "add" && proposed_value == null) ||
        (action === "replace" &&
          (original_value == null || proposed_value == null)) ||
        (action === "remove" && original_value == null)
      ) {
        return respond(
          { error: "Missing change information" },
          400,
          origin
        );
      }

      if (
        reason != null &&
        (typeof reason !== "string" || reason.length > 2000)
      ) {
        return respond(
          { error: "Invalid comments" },
          400,
          origin
        );
      }

      validatedChanges.push({
        field_name,
        action,
        original_value: original_value ?? null,
        proposed_value: proposed_value ?? null,
        reason: reason ?? null,
      });
    }

    if (!validText(turnstile_token, 1, 2048)) {
      return respond(
        { error: "Verification required" },
        400,
        origin
      );
    }

    let verification: {
      success?: boolean;
      hostname?: string;
    };

    try {
      const result = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret,
            response: turnstile_token,
          }),
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!result.ok) {
        return respond(
          { error: "Verification unavailable" },
          503,
          origin
        );
      }

      verification = await result.json();
    } catch {
      return respond(
        { error: "Verification unavailable" },
        503,
        origin
      );
    }

    const expectedHostname = new URL(origin).hostname;

    if (
      verification.success !== true ||
      verification.hostname !== expectedHostname ||
      !ALLOWED_HOSTNAMES.includes(verification.hostname)
    ) {
      return respond(
        { error: "Verification failed" },
        403,
        origin
      );
    }

    const { data, error } = await ctx.supabaseAdmin.rpc(
      "create_site_update_batch",
      {
        p_technician_name: String(technician_name).trim(),
        p_carrier: carrier,
        p_province: province,
        p_site_code: String(site_code).trim(),
        p_changes: validatedChanges,
      }
    );

    if (error) {
      console.error("Batch submission failed", error.code);

      return respond(
        { error: "Could not save submission" },
        500,
        origin
      );
    }

    // Submission succeeded. Email failures must not roll back a saved request.
    const notification = notifyAdministrators(ctx.supabaseAdmin, {
      site_code: String(site_code),
      carrier: String(carrier),
      technician_name: String(technician_name).trim(),
      fields: [...new Set(validatedChanges.map((c: any) => String(c.field_name)))],
      submission_id: data,
    }).catch((err: unknown) => console.error("Admin notification failed", err));
    // Keep the Edge Function alive until the notification task finishes.
    // If waitUntil is unavailable in the runtime, await the task safely.
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      EdgeRuntime.waitUntil(notification);
    } else {
      await notification;
    }

    return respond(
      {
        success: true,
        submission_id: data,
        change_count: validatedChanges.length,
        status: "pending",
        message: "Submitted for admin approval",
      },
      201,
      origin
    );
  }),
};
