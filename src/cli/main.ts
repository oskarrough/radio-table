/* eslint-env node */

import {Glob} from 'bun'
import {mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import pLimit from 'p-limit'
import {ProgressBar} from '@opentf/cli-pbar'
import {toFilename, fetchRemoteTracks, remoteTrackToTrack} from '../utils.ts'
import {setupDatabase, getTracks, upsertTrack} from './database.ts'
import {downloadTrack} from './download.ts'
import parseArguments from './parse-arguments.js'
// import type {LocalTrack, Track} from './schema.ts'

async function main() {
	console.time('STOP')
	const values = parseArguments()

	// Require slug
	if (!values.slug) {
		console.log('--slug <my-radio> selects the radio channel to use')
		process.exit(1)
	}

	// const limit = Number(values.limit)

	// Require explicit folder
	if (!values.folder) {
		console.log('--folder <path> decides where to save things locally')
		process.exit(1)
	} else {
		const radioPath = `${values.folder}/${values.slug}`
		const tracksFolder = `${radioPath}/tracks`
		// const databasePath = `${radioPath}/${values.slug}.sqlite`
		console.log('Using', radioPath)
		if (values.simulate) {
			console.log('Simulating, not creating folders', tracksFolder)
		} else {
			await mkdir(tracksFolder, {recursive: true})
		}
	}

	return

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
	const glob = new Glob(`${tracksFolder}/*.m4a`)
	const localFiles = await Array.fromAsync(glob.scan('.'))

	/** Create or reuse a local sqlite3 database */
	const db = await setupDatabase(databasePath)

	/** Find tracks stored in local database */
	const tracks = getTracks(db)

	/** Fetch remote tracks from Radio4000 */
	const {data, error} = await fetchRemoteTracks(slug, limit)
	if (error) throw Error(`remote: Failed to fetch tracks: ${error.message}`)
	const remoteTracks = data.map(remoteTrackToTrack).filter((x) => x !== null)

	if (!remoteTracks.length) {
		throw Error('remote: No tracks found. Was the radio migrated to v2? Is the slug correct?')
	}

	console.log('START:', slug, limit, databasePath)
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
		console.log('--pull', incomingTracks.length, 'remote tracks from Radio4000')
		// if (values.pull) {
		// 	incomingTracks.forEach((t) => {
		// 		upsertTrack(db, t)
		// 	})
		// 	console.log('Done pulling')
		// }
	} else {
		// console.log('Nothing to pull')
	}

	// download

	/*
↓
↑
 */

	// await Bun.write(`${folder}/${slug}.json`, JSON.stringify({tracks: getTracks(db)}, null, 2))
	console.timeEnd('STOP')

	//
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
