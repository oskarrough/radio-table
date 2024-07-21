playing around

## Things to fix

- I've temporarily hardcoded downloaded files to be in .m4a format, but this doesn't work some files. Let's let yt-dlp decide the format and updates track.files accordingly.

## We can compile the CLI into a standalone binary like so:

```
bun build --compile --minify --sourcemap ./src/cli.ts --outfile myapp
```
