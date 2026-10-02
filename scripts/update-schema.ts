#!/usr/bin/env bun
// Pulls Linear's published SDL into schema/linear.graphql. The file is not
// committed: its redistribution licence is unverified, and it drifts, so every
// checkout fetches its own copy.

const SOURCE =
  "https://raw.githubusercontent.com/linear/linear/master/packages/sdk/src/schema.graphql";
const TARGET = new URL("../schema/linear.graphql", import.meta.url);

const response = await fetch(SOURCE);
if (!response.ok) {
  console.error(`update-schema: ${response.status} ${response.statusText} from ${SOURCE}`);
  process.exit(1);
}
const sdl = await response.text();
if (!/^type Query\b/m.test(sdl)) {
  console.error("update-schema: downloaded file has no `type Query`, refusing to write it");
  process.exit(1);
}
await Bun.write(TARGET, sdl);
console.error(`update-schema: wrote ${sdl.length.toLocaleString()} bytes to ${TARGET.pathname}`);
