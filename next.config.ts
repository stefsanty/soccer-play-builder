import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The running build's version, read once here so the badge in the layout always shows what was actually
// deployed rather than whatever anyone remembers shipping.
const { version } = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as { version: string };

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // The dev-tools badge sat on the builder's bottom-left button at phone width and swallowed real
  // taps (Rewind, then Preview), so the dev build could not be playtested on a phone. Dev only.
  devIndicators: false,
  async redirects() {
    return [
      // Queue-and-play prototype: a self-contained static page served from public/.
      { source: "/test", destination: "/test.html", permanent: false },
    ];
  },
};

export default nextConfig;
