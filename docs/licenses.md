# Dependency licenses

Every runtime dependency of skifer-board must have a permissive license (MIT, BSD, Apache 2.0 or
equivalent). This table is the record; adding a dependency without updating it fails review.

| Dependency | License | Used for | Verified on |
|---|---|---|---|
| _none yet — the repository is documentation only_ | | | |

Candidates evaluated in the roadmap (to be verified at adoption time):

| Project | License | Role considered |
|---|---|---|
| Apache ECharts | Apache 2.0 | Default tile renderer |
| Vega-Lite | BSD-3 | Alternative renderer for specific tile kinds |
| Next.js, React | MIT | Web app |
| Tailwind CSS, shadcn/ui, zustand | MIT | Web app |
| FastAPI, httpx, Pydantic | MIT / BSD-3 / MIT | Backend |
| APScheduler | MIT | Reporting scheduler |
| Playwright | Apache 2.0 | Hermetic e2e tests, headless PDF/PNG export |
| Monaco Editor / CodeMirror | MIT | In-browser YAML editor |
