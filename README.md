# envgap

Finds environment variables your code reads that `.env.example` doesn't mention,
and the other way round. Zero dependencies, one command.

![envgap output](screenshot.png)

```
$ npx github:TheRealAlexxx/envgap .
read by the code but missing from .env.example:
  STRIPE_WEBHOOK_SECRET       src/billing.js, src/hooks.js
listed in .env.example but never read:
  OLD_FEATURE_FLAG
```

A small demo project ships in the repo if you want to try it right now:

```
$ npx github:TheRealAlexxx/envgap examples/demo
read by the code but missing from .env.example:
  OLD_FEATURE                 src/server.js
  PORT                        src/server.js
  QUEUE_URL                   src/jobs.js
```

Exit code 1 when something is read but undocumented (so it works in CI), 0
otherwise, 2 when there is no example file. `--json` for machine output. Errors always print plain text to stderr and exit 2, even with `--json`.

When a read has an inline default, the report says so instead of treating the
variable as undocumented-and-required: `# has a default`, `# default is an
empty string`, or `# default is the variable's own name`. A shell `${X:?}`
read is marked `# shell read fails when unset`. These describe how the code
reads the variable, not whether you need to set it: an empty-string default
often still means effectively required. In `--json`, each undocumented entry
carries `defaulted`, `default_kind` (`empty`, `sentinel`, `literal`,
`expression` or null) and `shell_required`.

## What it looks at

- Example file: `.env.example`, `.env.sample` or `.env.template`. A commented
  `# KEY=value` line counts as documented (an optional variable).
- Reads: `process.env.X`, `process.env["X"]`, `import.meta.env.X`,
  `os.environ[...]`/`.get`, `os.getenv`, `ENV[...]`/`ENV.fetch`, `os.Getenv`,
  `env::var`, `getenv`, and `$X`/`${X}` in `.sh` files. Names must be UPPER_CASE.
- Skips `node_modules`, `.git`, `dist`, `build`, `vendor` and similar, plus
  bundled/minified assets (`*.min.js`, `*.bundle.js`, `public/vs`). Pass
  `--exclude-tests` to also skip `test`/`tests`/`__tests__`/`spec` directories,
  and `--exclude NAME` to skip any other directory.
- Ignores variables the platform sets: `NODE_ENV`, `PATH`, `HOME`, `CI`, etc.,
  plus the documented GitHub Actions default and runner variables
  (`GITHUB_OUTPUT`, `RUNNER_OS`, `ACTIONS_RUNTIME_TOKEN`, ...). A name the
  project's own example file mentions is never ignored this way, and no
  `GITHUB_*` pattern is ignored wholesale: `GITHUB_CLIENT_ID` in your code is
  still reported.

## Limits

It only sees explicit reads. A library that reads `POSTGRES_URL` or `AUTH_SECRET`
on its own will show up under "never read". Try it on
`vercel/next-learn/dashboard/final-example`: all eight listed variables are read
by libraries, not by the app code. Treat that section as a prompt to check, not
an error. Dynamic names (`process.env[name]`) and destructuring (`const {X} = process.env`) are not found.
Runtime-to-build-time prefix mapping (an entrypoint that reads `ALLOW_EMBED`
and writes `NEXT_PUBLIC_ALLOW_EMBED`) is not inferred. Framework config
objects such as pydantic settings are not parsed; only direct reads count.

## Tests

```
node --test
```

## License

MIT
