# Getting started in a code project

```bash
git init
git add -A
git commit -m "NoteWell 1.5"
```

Then either point Claude Code at the folder (`claude` from inside it), or open
it in your editor.

## The loop

```bash
npm start            # run it locally at http://localhost:8787
npm test             # 158 tests
npm run release      # bump 0.1, build, file a copy in ~/Desktop/Notewell
```

`npm run release` writes `dist-web/` — upload the contents of that to the
GitHub Pages repo. `PUBLISHING.md` has the detail.

## Two repos, or one?

`dist-web/` is gitignored here because this repo holds the **source**. Keep
publishing the built files to your existing `notewellapp` repo.

If you would rather have one repo that builds itself, delete `dist-web` from
`.gitignore`, keep `.github/workflows/deploy.yml`, and set the Pages source to
**GitHub Actions**. Then every push rebuilds and republishes on its own.

## Optional extras

```bash
node setup/fetch-fonts.js    # real EB Garamond instead of the fallback serif
node setup/fetch-vendor.js   # the PDF reader, so PDF import works offline
```

Both are one-time and need a connection. Skip them and NoteWell still works.

## Read this first

`CLAUDE.md` lists the decisions that were painful to arrive at — mostly about
why certain gestures are off by default and why the ink is drawn the way it is.
Worth two minutes before changing the drawing code.
