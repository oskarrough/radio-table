Playing around. There are two things here:

1. A CLI program to manage a Radio4000 channel
2. A React (very configurable) <table> component for rendering a table of tracks

## The CLI

Note, this only works with `bun` for now. Sorry.

```
Usage: bun src/cli/main.ts [...args]


Options:
	--slug      Slug of the radio to use
	--folder    Folder to download the tracks to
	--pull      Pull tracks from Radio4000
	--download  Download music files from tracks
```

bun src/cli/main.ts --slug oskar --folder ~/Dropbox/Music/Radios/ --simulate

I've temporarily hardcoded downloaded files to be in .m4a format, but this doesn't work some files. Let's let yt-dlp decide the format and updates track.files accordingly.

We can compile the CLI into a standalone binary like so:

```
bun build --compile --minify --sourcemap ./src/cli.ts --outfile r4
./r4 --slug oskar --folder ~/Music --pull --download
```

## The table component
