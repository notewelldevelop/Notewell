# Publishing NoteWell on GitHub Pages

This is the guide for **you**, the person maintaining it. The one you hand your
classmates is [INSTALL-ON-IPAD.md](INSTALL-ON-IPAD.md).

---

## What your repo should contain

You've uploaded the **contents of `dist-web`** to the repo root. That's the
right call — keep it that way. The repo root should look like this:

```
index.html            the whole app in one file
sw.js                 offline cache
manifest.webmanifest
version.json          how installed copies notice a new release
icons/
  icon-192.png
  icon-512.png
READ-ME-FIRST.txt     harmless, ignore it
```

Nothing else needs to be in there. Don't put the source in this repo — see
*Keeping the source somewhere* at the bottom.

**Turn Pages on once:** repo → **Settings → Pages** → Source: *Deploy from a
branch* → Branch `main`, folder `/ (root)` → **Save**.

Your address is `https://YOUR-USERNAME.github.io/REPO-NAME/`.

---

## Shipping an update

```bash
npm run release
```

That bumps the version by 0.1, rebuilds, and files a copy in
`~/Desktop/Notewell/Version 1.6` (and so on) so every build you have ever
published stays on disk. Then upload the **contents of that folder** to the
repo, replacing what's there:

- `npm run release -- --notes "Fixed the highlighter"` records a note in
  `version.json`
- `npm run release -- --same` rebuilds without bumping
- set `NOTEWELL_RELEASES` to keep the folders somewhere else
- `npm run web` still works if you only want `dist-web` and no versioned copy

**In the browser** — repo → **Add file → Upload files** → drag everything from
inside `dist-web` → **Commit changes**. GitHub overwrites files with the same
name, so you don't need to delete anything first.

**With git**, if you have it:

```bash
cp -r "$HOME/Desktop/Notewell/Version 1.6/." /path/to/your/repo/
cd /path/to/your/repo
git add -A && git commit -m "Update NoteWell" && git push
```

That's the whole loop. Every classmate with it installed is told within a few
minutes and updates with one tap.

> Add a note to the release by setting `NOTEWELL_NOTES` before building:
> `NOTEWELL_NOTES="Fixed palm rejection" npm run web`

---

## How long GitHub takes

**Usually one to two minutes.** The upper bound is worse than people expect:
the build can take up to about 10 minutes, and pushing it out across GitHub's
CDN can take another 10, so roughly **20 minutes worst case**.

If it looks like nothing changed after that:

1. **It's almost always your browser, not GitHub.** Hard-refresh — on a Mac
   `⌘⇧R`; on an iPad, close the tab and reopen.
2. Check the **Actions** tab in your repo — a Pages deployment shows there with
   a tick or a cross.
3. Open `https://YOUR-USERNAME.github.io/REPO/version.json` directly. If the
   version there is the new one, GitHub is done and it's a caching issue on
   your device.

An **installed** NoteWell is a slightly different story: it serves the cached
copy first so it opens instantly, then checks for a newer one in the
background. So a classmate might open the old version once and get the update
prompt a moment later. That's by design — nobody's mid-sentence gets
interrupted by a reload.

---

## What happens on your classmates' iPads

- On launch, and every couple of hours, NoteWell fetches `version.json`.
- If it's newer than the running build, a small bar appears at the bottom:
  *"A new version of NoteWell is ready. Your notes are not affected."*
- They tap **Update now**; it reloads into the new version in about a second.
- If they ignore it, they keep using the old one perfectly happily and get
  asked again next launch. Nothing breaks.
- **Their notes are never touched by an update.** Notes live in the browser
  database; the update only replaces app files.

There's also **Settings → Check for updates**, showing the version they're on.

---

## Things that will bite you

**Don't rename the repo.** Notes are stored per web address. Changing the repo
name or username creates a brand-new empty NoteWell for everyone, and their old
notes will still exist but only at the old URL. If you must move, tell people to
**Backup / restore → Save to Files** first, then restore at the new address.

**Don't add a custom domain casually** — same problem, same fix.

**Test before you push to everyone.** Open `dist-web/index.html` locally, or run
`npm start`, and click around. Once it's on Pages, it's on everyone's iPad
within minutes.

**Keep the version number moving.** `npm run web` handles this automatically —
it derives a fresh stamp from the build time. If you ever hand-edit files in the
repo without rebuilding, `version.json` won't change and nobody gets prompted.

---

## Keeping the source somewhere

The repo you're publishing holds the *built* app. The source — `js/`, `css/`,
`tests/`, the build scripts — should live somewhere too, or you won't be able to
make changes later.

Simplest: a **second, private repo** for the source, and keep publishing the
built files to the public one.

If you'd rather have one repo that builds itself, put the source in it and add
`.github/workflows/deploy.yml` (included in this folder). Then every `git push`
rebuilds and republishes automatically, and shipping an update is just a commit.
Repo → **Settings → Pages** → Source: **GitHub Actions**.

---

## A quick sanity checklist before you share the link

- [ ] Opens in Safari on your own iPad
- [ ] Share → Add to Home Screen works and shows the NW icon
- [ ] Opens from the home screen full-screen, no Safari bars
- [ ] Aeroplane Mode: still opens, you can still write
- [ ] Settings shows a version number, not "development build"
- [ ] `.../version.json` loads in a browser
- [ ] You've made yourself a backup file
