import { T3Store } from "../src/store.js";
import { T3Client } from "../src/t3-client.js";

const store = new T3Store();
let gotConfig = false;
let gotShell = false;

const client = new T3Client(
  {
    onConnectionChange: (state, detail) => {
      console.log(`[connection] ${state}${detail ? ` (${detail})` : ""}`);
    },
    onConfigSnapshot: (cfg) => {
      store.applyConfigSnapshot(cfg);
      gotConfig = true;
      checkDone();
    },
    onProvidersUpdated: (providers) => store.applyProvidersUpdated(providers),
    onUsageLimitSourcesUpdated: (sources) => store.applyUsageLimitSourcesUpdated(sources),
    onShellSnapshot: (projects, threads, isEnrichment) => {
      store.applyShellSnapshot(projects, threads, isEnrichment);
      if (!isEnrichment) {
        gotShell = true;
        checkDone();
      }
    },
    onProjectUpdated: (p) => store.applyProjectUpdated(p),
    onProjectRemoved: (id) => store.applyProjectRemoved(id),
    onThreadUpdated: (t, loc) => store.applyThreadUpdated(t, loc),
    onThreadRemoved: (id) => store.applyThreadRemoved(id)
  },
  {
    logger: (level, msg) => console.log(`[${level}] ${msg}`)
  }
);

const timeout = setTimeout(() => {
  console.error("Smoke test timed out");
  client.stop();
  process.exit(1);
}, 12_000);

function checkDone() {
  if (!gotConfig || !gotShell) return;
  clearTimeout(timeout);

  const stats = store.getFleetStats();
  const active = store.getFilteredThreads("active");
  const favModels = store.getModelCatalog("favorites");
  const allModels = store.getModelCatalog("all");
  const usage = store.getUsageCards();

  const focused = store.getFocusedThread();
  console.log("Environment ID:", store.environmentId);
  console.log("Focused Thread (live active in T3):", focused ? `${focused.title} (${store.getProjectName(focused.projectId)}) [${focused.modelSelection?.model}]` : "none");
  console.log("Fleet Stats:", stats);
  console.log("Top 5 Active Threads:");
  for (const t of active.slice(0, 5)) {
    console.log(
      `  - [${t.status}] (${store.getProjectName(t.projectId)}) ${t.title} — ${t.modelSelection?.model} (${t.runtimeMode}/${t.interactionMode})`
    );
  }
  console.log(`Favorite Models (${favModels.length}):`, favModels.map((m) => `${m.providerLabel}:${m.shortName}`).join(", "));
  console.log(`All Ready Models (${allModels.length}):`, allModels.slice(0, 6).map((m) => `${m.providerLabel}:${m.shortName}`).join(", "));
  console.log(
    `Usage Cards (${usage.length}):`,
    usage.map((u) => `${u.label}[s=${u.sessionWindow?.usedPercent ?? "-"}%,w=${u.weeklyWindow?.usedPercent ?? "-"}%]`).join(", ")
  );

  client.stop();
  process.exit(0);
}

client.start();
