import {$, ShellError} from 'bun'
import {Database} from 'bun:sqlite'
import type {Track, SQLTrack} from '../schema.ts'

/** Downloads the audio from a URL (supported by yt-dlp) */
export async function downloadAudio(url: string, filepath: string, metadataDescription: string) {
	return $`yt-dlp -f 'bestaudio[ext=m4a]' --no-playlist --restrict-filenames --output ${filepath} --parse-metadata "${metadataDescription}:%(meta_comment)s" --embed-metadata --quiet --progress ${url} --cookies-from-browser firefox`
}

/** Downloads the URL of a track to disk, and updates the track in the local database. */
export async function downloadTrack(t: SQLTrack | Track, filename: string, db: Database) {
	try {
		await downloadAudio(t.url, `${filename}`, t.description || '')
		db.query(`UPDATE tracks SET files = $files, lastError = $lastError WHERE id = $id;`).run({
			id: t.id,
			files: `${filename}`,
			lastError: null,
		})
	} catch (err: unknown) {
		// note, the stderr is logged to the console before this..
		const error = err as ShellError
		t.lastError = `Error downloading track: ${error.stderr.toString()}`
		db.query(`UPDATE tracks SET files = $files, lastError = $lastError WHERE id = $id;`).run({
			id: t.id,
			files: null,
			lastError: t.lastError,
		})
	}
}

// If a video added in playlist, download it through my command
// If a video is removed, delete it.
// If a video turned unavailable, skip deleting it.
// If a video already exists locally, skip downloading it.
function download() {
	if (values.download) {
		const list = getTracks(db)
			.slice(0, limit)
			.filter((track) => {
				const filename = toFilename(track, tracksFolder)
				const exists = existsSync(filename)
				if (exists && !track.files) {
					console.log('Found existing track', track.id)
					db.query('update tracks set files = ? where id = ?').run(filename, track.id)
				}
				return !exists
			})
			.filter((track) => (values.downloadFailed ? true : !track.lastError))
		if (list.length) {
			console.log('Downloading', list.length, 'tracks. It will take around', list.length * 4, 'seconds. See ya')

			pBar.start({total: list.length})
			pBar.update({suffix: 'downloading tracks'})
			const limiter = pLimit(5)
			const input = list.map((track) =>
				limiter(async () => {
					await downloadTrack(track, toFilename(track, tracksFolder), db)
					pBar.inc()
				}),
			)
			await Promise.all(input)
			pBar.stop()

			console.log(
				getTracks(db)
					.slice(0, limit)
					.filter((x) => x.files).length,
				'tracks downloaded.',
			)

			console.log(
				getTracks(db)
					.slice(0, limit)
					.filter((x) => x.lastError).length,
				'tracks failed to download. Use --downloadFailed to try again',
			)
		} else {
			// console.log('all downloaded')
		}
	} else {
		const toDownload = getTracks(db).filter((t) => !t.lastError && !t.files)
		console.log('--download', toDownload.length, 'missing files')
	}

	if (values.download && !values.downloadFailed) {
		const q2 = getTracks(db).filter((t) => t.lastError)
		console.log('--download --downloadFailed to include', q2.length, 'files that previously failed')
	}
}
