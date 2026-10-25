import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { runHealth } from "../services/health.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const checks = await runHealth(admin, session.shop);
  return { checks };
};

const ICON = { ok: "🟢", warn: "🟠", fail: "🔴" } as const;
const cell = { padding: "8px 10px", textAlign: "left" as const, borderBottom: "1px solid #e1e3e5", verticalAlign: "top" as const };

export default function HealthPage() {
  const { checks } = useLoaderData<typeof loader>();
  const bad = checks.filter((c) => c.level !== "ok").length;
  return (
    <s-page heading="Health check">
      <s-section heading={bad === 0 ? "Everything is fine" : `${bad} thing(s) to look at`}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {checks.map((c) => (
              <tr key={c.name}>
                <td style={{ ...cell, width: 40 }}>{ICON[c.level]}</td>
                <td style={{ ...cell, width: 200 }}><strong>{c.name}</strong></td>
                <td style={cell}>
                  {c.detail}
                  {c.fix ? <div style={{ color: "#b54708" }}>→ {c.fix}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <s-paragraph>
          Related pages: <Link to="/app/sync">Orders sync</Link>, <Link to="/app/meta">Meta ads</Link>,{" "}
          <Link to="/app/costs">Costs</Link>.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
