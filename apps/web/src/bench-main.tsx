import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { runBench } from "./prototype/bench";
import { BenchReport } from "./prototype/BenchReport";

// Mesure synchrone avant le premier rendu React : une capture headless (`--dump-dom`) lit le
// résultat dès l'événement `load`.
const host = document.getElementById("bench-host");
const root = document.getElementById("root");
if (host === null || root === null) {
  throw new Error("Éléments #bench-host ou #root absents de bench.html");
}
const results = runBench(host);
const environment = `${navigator.userAgent} · ${String(navigator.hardwareConcurrency)} cœurs logiques`;
const raw = document.createElement("pre");
raw.id = "bench-raw";
raw.textContent = JSON.stringify({ environment, results });
document.body.append(raw);
createRoot(root).render(
  <StrictMode>
    <BenchReport results={results} environment={environment} />
  </StrictMode>,
);
