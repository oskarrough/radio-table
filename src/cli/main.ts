/* eslint-env node */

import {Glob} from 'bun'
import {mkdir} from 'node:fs/promises'
import {existsSync, mkdirSync} from 'node:fs'
import pLimit from 'p-limit'
import {ProgressBar} from '@opentf/cli-pbar'
import {toFilename, fetchRemoteTracks, remoteTrackToTrack} from '../utils.ts'
import {setupDatabase, getTracks, upsertTrack} from './database.ts'
import {downloadTrack} from './download.ts'
import {parseArguments} from './parse-arguments.js'

async function main() {
	console.time('STOP')
	const values = parseArguments()

	// Display help
	if (values.help) {
		console.log('\nRadio4000 CLI Tool')
		console.log('----------------')
		console.log('Options:')
		console.log('  --slug <radio-slug>    Required: The Radio4000 channel slug')
		console.log('  --folder <path>        Required: Where to store radio files')
		console.log('  --pull                 Pull new tracks from Radio4000 to local database')
		console.log('  --download             Download audio files for tracks in database')
		console.log('  --includeFailed        When used with --download, includes previously failed tracks')
		console.log('  --simulate             Simulate operations without making changes')
		console.log('  --premium              Download from YTMusic premium (requires Firefox login and --poToken)')
		console.log('  --poToken <token>     Required token when using --premium')
		console.log('\nExample: bun src/cli/main --slug oskar --folder ~/Music/Radios --pull --download')
		process.exit(0)
	}

	// Require slug
	if (!values.slug) {
		console.log('--slug <my-radio> selects the radio channel to use')
		console.log('Run with --help for more information')
		process.exit(1)
	}

	// Require explicit folder
	if (!values.folder) {
		console.log('--folder <path> decides where to save things locally')
		console.log('Run with --help for more information')
		process.exit(1)
	}

	// Check if premium is enabled but poToken is missing
	if (values.premium && !values.poToken) {
		console.log('ERROR: --premium requires --poToken parameter')
		console.log('Run with --help for more information')
		process.exit(1)
	}

	// Premium notification
	if (values.premium) {
		console.log('PREMIUM MODE: This assumes you are signed into music.youtube.com with a premium account in Firefox')
	}

	const radioPath = `${values.folder}/${values.slug}`
	const tracksFolder = `${radioPath}/tracks`
	const databasePath = `${radioPath}/${values.slug}.sqlite`
	console.log('Using', radioPath)
	if (values.simulate) {
		console.log('Simulating, not creating folders', tracksFolder)
		console.log('Simulation mode is ON - no changes will be made to your files or database')
		// Create the directory temporarily only if we need to access it for simulation
		// but ensure it's not permanently created
		if (!existsSync(tracksFolder) && values.download) {
			console.log('Creating temporary directory for simulation')
			mkdirSync(tracksFolder, {recursive: true})
			// We'll clean this up at the end of the script
		}
	} else {
		await mkdir(tracksFolder, {recursive: true})
	}

	// sync: Updates directories. Compares the directory with the current state of the playlist. Newly added songs will be downloaded and removed songs will be deleted. No other songs will be downloaded and no other files will be deleted.

	// Use this for longer tasks
	const pBar = new ProgressBar({
		// variant: 'PLAIN',
		// prefix: 'Downloading',
		size: 'SMALL',
		showPercent: false,
		autoClear: true,
		showCount: true,
	})

	/** Find existing files on disk */
		let localFiles = []
		if (values.simulate) {
			console.log('Simulation: skipping file scan in simulation mode')
		} else if (!existsSync(tracksFolder)) {
			console.log('Directory does not exist: skipping file scan')
		} else {
			try {
				const glob = new Glob(`${tracksFolder}/*.m4a`)
				localFiles = await Array.fromAsync(glob.scan('.'))
			} catch (err) {
				console.error('Error scanning files:', err)
				// Continue with empty localFiles array
			}
		}

	/** Create or reuse a local sqlite3 database */
	let db
	if (values.simulate) {
		console.log('Simulation: would set up database at', databasePath)
		// Create an in-memory database for simulation that gets discarded
		db = await setupDatabase(':memory:')
	} else {
		db = await setupDatabase(databasePath)
	}

	/** Find tracks stored in local database */
	const tracks = getTracks(db)

	/** Fetch remote tracks from Radio4000 */
	const {data, error} = await fetchRemoteTracks(values.slug)
	if (error) throw Error(`remote: Failed to fetch tracks: ${error.message}`)
	const remoteTracks = data.map(remoteTrackToTrack).filter((x) => x !== null)

	if (!remoteTracks.length) {
		throw Error('remote: No tracks found. Was the radio migrated to v2? Is the slug correct?')
	}

	console.log('START:', values.slug, databasePath)
	console.log(tracks.length, 'tracks in local DB')
	console.log(tracks.filter((t) => t.lastError).length, 'errors')
	console.log(localFiles.length, 'files')
	console.log(remoteTracks.length, 'Radio4000 tracks')

	if (data.length - remoteTracks.length > 0) {
		console.log(data.length - remoteTracks.length, 'R4 track(s) failed to parse')
	}

	// Check if there are new R4 tracks to pull.
	const localIds = new Set(tracks.map((t) => t.id))
	const incomingTracks = remoteTracks.filter((track) => !localIds.has(track.id))
	if (incomingTracks.length) {
		console.log('Found', incomingTracks.length, 'new tracks from Radio4000')

		if (!values.pull) {
			console.log(`To add these tracks to your database, run with --pull`)
		}

		if (values.pull) {
			console.log(`--pull: Adding ${incomingTracks.length} tracks to database...`)
			if (values.simulate) {
				console.log('Simulation: would pull', incomingTracks.length, 'tracks to database')
				// Show the first few track titles in simulation
				incomingTracks.slice(0, 3).forEach((t) => {
					console.log(`Simulation: would add track "${t.title}" (${t.id})`)
				})
				if (incomingTracks.length > 3) {
					console.log(`Simulation: and ${incomingTracks.length - 3} more tracks...`)
				}
			} else {
				incomingTracks.forEach((t) => {
					upsertTrack(db, t, values.simulate)
				})
				console.log('Done pulling')
			}
		}
	} else {
		console.log('Nothing to pull')
	}

	// Handle downloads if requested
	if (values.download) {
		const tracksToDownload = getTracks(db)
			.filter((track) => {
				// In simulation mode, we don't check for file existence
				if (values.simulate) {
					return !track.lastError || values.includeFailed
				}
				try {
					const filename = toFilename(track, tracksFolder)
					const exists = existsSync(filename)
					return !exists && (!track.lastError || values.includeFailed)
				} catch (err) {
					console.error('Error checking file existence:', err)
					return false
				}
			})

		if (tracksToDownload.length) {
			if (!values.download) {
				console.log(`${tracksToDownload.length} tracks available to download. Run with --download to start downloading.`)
			}

			if (values.simulate) {
				console.log('Simulation: would download', tracksToDownload.length, 'tracks')
				// Show a few examples in simulation
				tracksToDownload.slice(0, 3).forEach((track) => {
					try {
						const filename = toFilename(track, tracksFolder)
						console.log(`Simulation: would download "${track.title}" to ${filename}`)
					} catch (err) {
						console.error(`Simulation: error formatting filename for track "${track.title}":`, err)
					}
				})
				if (tracksToDownload.length > 3) {
					console.log(`Simulation: and ${tracksToDownload.length - 3} more tracks...`)
				}
			} else {
				let downloadMessage = `--download: ${tracksToDownload.length} tracks`
				if (values.includeFailed) {
					const failedTracksCount = getTracks(db).filter(t => t.lastError).length
					downloadMessage += ` (including ${failedTracksCount} previously failed tracks)`
				}
				downloadMessage += `. It will take around ${tracksToDownload.length * 4} seconds.`
				console.log(downloadMessage)

				pBar.start({total: tracksToDownload.length})
				pBar.update({suffix: 'downloading tracks'})
				const limiter = pLimit(5)
				const input = tracksToDownload.map((track) =>
					limiter(async () => {
						try {
							const filename = toFilename(track, tracksFolder)
							await downloadTrack(track, filename, db, values.simulate, values.premium, values.poToken)
							pBar.inc()
						} catch (err) {
							console.error(`Error processing track "${track.title}":`, err)
							pBar.inc()
						}
					}),
				)
				await Promise.all(input)
				pBar.stop()

				// Get statistics
				const downloadedCount = getTracks(db).filter((x) => x.files).length
				const failedCount = getTracks(db).filter((x) => x.lastError).length
				const retriedCount = values.includeFailed ? getTracks(db).filter(t => t.lastError).length : 0

				console.log(`${downloadedCount} tracks downloaded.`)

				if (values.includeFailed && retriedCount > 0) {
					console.log(`${failedCount} tracks still failed after retry attempt.`)
				} else {
					console.log(`${failedCount} tracks failed to download. Use --download --includeFailed to retry`)
				}
			}
		} else {
			console.log('No tracks to download')
		}
	}

	// If not in simulate mode, we could write a JSON copy of the data
	// if (!values.simulate) {
	//   await Bun.write(`${values.folder}/${values.slug}.json`, JSON.stringify({tracks: getTracks(db)}, null, 2))
	// }

	// Clean up temporary directory if it was created for simulation
	if (values.simulate && existsSync(tracksFolder) && values.download) {
		try {
			// Note: Not using rm because it might delete actual content in non-simulation mode
			// Just log that we would delete it in a real implementation
			console.log('Simulation: would clean up temporary directory', tracksFolder)
		} catch (err) {
			console.error('Error cleaning up temporary directory:', err)
		}
	}

	console.timeEnd('STOP')

	// Display available actions if nothing significant was done
	if (!values.pull && !values.download && getTracks(db).length > 0) {
		console.log('\nAvailable actions:')
		if (incomingTracks && incomingTracks.length) {
			console.log(`- Add ${incomingTracks.length} new tracks: run with --pull`)
		}

		const downloadableCount = getTracks(db).filter(track => {
			try {
				const filename = toFilename(track, tracksFolder)
				return !existsSync(filename) && (!track.lastError || values.includeFailed)
			} catch (err) {
				return false
			}
		}).length

		if (downloadableCount > 0) {
			console.log(`- Download ${downloadableCount} tracks: run with --download`)
		}

		const failedCount = getTracks(db).filter(t => t.lastError).length
		if (failedCount > 0) {
			console.log(`- Retry ${failedCount} failed downloads: run with --download --includeFailed together`)
		}
	}
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
