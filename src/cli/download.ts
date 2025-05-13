import {$, ShellError} from 'bun'
import {Database} from 'bun:sqlite'
import type {Track, SQLTrack} from '../schema.ts'

/** Downloads the audio from a URL (supported by yt-dlp) */
export async function downloadAudio(url: string, filepath: string, metadataDescription: string, premium = false, poToken?: string) {
	if (!premium) return $`yt-dlp -f 'bestaudio[ext=m4a]' --no-playlist --restrict-filenames --output ${filepath} --parse-metadata "${metadataDescription}:%(meta_comment)s" --embed-metadata --quiet --progress ${url} --cookies-from-browser firefox`
	
	if (!poToken) {
		throw new Error('Premium download requires a PO Token. Please provide it with --poToken parameter.')
	}
	
	return $`yt-dlp -f 'bestaudio[ext=m4a]' --no-playlist --restrict-filenames --output ${filepath} --parse-metadata "${metadataDescription}:%(meta_comment)s" --embed-metadata --quiet --progress ${url} --cookies-from-browser firefox --extractor-args "youtube:player-client=web_music;po_token=web_music.gvs+${poToken}"`
}

/** Downloads the URL of a track to disk, and updates the track in the local database.
 * Pass simulate=true to only log actions without making changes.
 */
export async function downloadTrack(t: SQLTrack | Track, filename: string, db: Database, simulate = false, premium = false, poToken?: string) {
	// Validate inputs to prevent errors
	if (!t || !t.id || !t.url) {
		console.error('Invalid track data provided to downloadTrack')
		return
	}

	if (simulate) {
		console.log(`Simulation: would download "${t.title}" from ${t.url} to ${filename}`)
		return
	}

	try {
		await downloadAudio(t.url, filename, t.description || '', premium, poToken)

		try {
			db.query(`UPDATE tracks SET files = $files, lastError = $lastError WHERE id = $id;`).run({
				id: t.id,
				files: filename,
				lastError: null,
			})
		} catch (dbErr) {
			console.error('Error updating database after download:', dbErr)
		}
	} catch (err: unknown) {
		// note, the stderr is logged to the console before this..
		let errorMessage = 'Error downloading track'

		// Try to extract a more detailed error message if available
		if (err && typeof err === 'object') {
			// Check for stderr property (common in shell command errors)
			if ('stderr' in err && err.stderr) {
				errorMessage = `${err.stderr.toString()}`
			}
			// Check for message property (common in standard Error objects)
			else if ('message' in err && err.message) {
				errorMessage = `${err.message}`
			}
		}

		console.error('Download error details:', errorMessage)

		t.lastError = errorMessage

		try {
			db.query(`UPDATE tracks SET files = $files, lastError = $lastError WHERE id = $id;`).run({
				id: t.id,
				files: null,
				lastError: t.lastError,
			})
		} catch (dbErr) {
			console.error('Error updating database after download failure:', dbErr)
		}
	}
}

// If a video added in playlist, download it through my command
// If a video is removed, delete it.
// If a video turned unavailable, skip deleting it.
// If a video already exists locally, skip downloading it.
// async function wip_download(simulate = false) {
// 	if (values.download) {
// 		const list = getTracks(db)
// 			.slice(0, limit)
// 			.filter((track) => {
// 				const filename = toFilename(track, tracksFolder)
// 				const exists = existsSync(filename)
// 				if (exists && !track.files) {
// 					if (simulate) {
// 						console.log('Simulation: would update database with existing track', track.id)
// 					} else {
// 						console.log('Found existing track', track.id)
// 						db.query('update tracks set files = ? where id = ?').run(filename, track.id)
// 					}
// 				}
// 				return !exists
// 			})
// 			.filter((track) => (values.includeFailed ? true : !track.lastError))
// 		if (list.length) {
// 			if (simulate) {
// 				console.log('Simulation: would download', list.length, 'tracks')
// 				list.slice(0, 3).forEach(track => {
// 					console.log(`Simulation: would download "${track.title}" (${track.id})`)
// 				})
// 				if (list.length > 3) {
// 					console.log(`Simulation: and ${list.length - 3} more tracks...`)
// 				}
// 			} else {
// 				console.log('Downloading', list.length, 'tracks. It will take around', list.length * 4, 'seconds. See ya')

// 				pBar.start({total: list.length})
// 				pBar.update({suffix: 'downloading tracks'})
// 				const limiter = pLimit(5)
// 				const input = list.map((track) =>
// 					limiter(async () => {
// 						await downloadTrack(track, toFilename(track, tracksFolder), db, simulate)
// 						pBar.inc()
// 					}),
// 				)
// 				await Promise.all(input)
// 				pBar.stop()

// 				console.log(
// 					getTracks(db)
// 						.slice(0, limit)
// 						.filter((x) => x.files).length,
// 					'tracks downloaded.',
// 				)

// 				console.log(
// 					getTracks(db)
// 						.slice(0, limit)
// 						.filter((x) => x.lastError).length,
// 					'tracks failed to download. Use --includeFailed to try again',
// 				)
// 			}
// 		} else {
// 			console.log('No tracks to download')
// 		}
// 	} else {
// 		const toDownload = getTracks(db).filter((t) => !t.lastError && !t.files)
// 		console.log('--download', toDownload.length, 'missing files')
// 	}

// 	if (values.download && !values.includeFailed) {
// 		const q2 = getTracks(db).filter((t) => t.lastError)
// 		console.log('--download --includeFailed to include', q2.length, 'files that previously failed')
// 	}
// }
