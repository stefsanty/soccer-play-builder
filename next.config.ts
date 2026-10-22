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
};

export default nextConfig;
