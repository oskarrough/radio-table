import {$, Glob, ShellError} from 'bun'
import {Database} from 'bun:sqlite'
import {parseArgs} from 'util'
import filenamify from 'filenamify/browser'
import {createBackup} from '../utils.ts'
import type {Track} from '../schema'
import {mkdir} from 'node:fs/promises'

// Run with  bun src/cli/r4.ts --slug oskar --limit 3 --folder src/cli/oskar

// Get CLI arguments (only strings + booleans)
const {values} = parseArgs({
	args: Bun.argv,
	options: {
		slug: {
			type: 'string',
		},
		limit: {
			type: 'string',
			default: '4000',
		},
		folder: {
			type: 'string',
		},
		includeFailed: {
			type: 'boolean',
		},
		force: {
			type: 'boolean',
		},
		debug: {
			type: 'boolean',
		},
		deleteDuplicates: {
			type: 'boolean',
		},
	},
	strict: true,
	allowPositionals: true,
})
if (!values.slug) throw Error('Pass in `--slug <my-radio>` to select your channel')
if (!values.folder) throw Error('Pass in `--folder <path>` to decide where to store your radio')
main(values.slug, Number(values.limit), `${values.folder}/${values.slug}`)

/** Downloads all tracks from a radio */
async function main(slug: string, limit: number, folder: string) {
	await mkdir(folder, {recursive: true})
	const db = await setupDatabase(`${folder}/${slug}.sqlite`)

	const {data, error} = await createBackup(slug, limit)
	if (error || !data) throw error

	await Bun.write(`${folder}/${slug}.json`, JSON.stringify(data, null, 2))

	// For each remote track, check if we tried (and failed) to download it previously.
	const tracks = data.tracks.map((t: Track) => {
		const q = db.query('select downloaded, files, last_error as lastError from tracks where id = $id;')
		const row = q.get({id: t.id}) as Track
		t.downloaded = row?.downloaded
		t.files = row?.files
		t.lastError = row?.lastError
		return t
	})

	const tracksWithError = tracks.filter((t) => t.lastError)
	const filteredTracks = values.includeFailed ? tracks : tracks.filter((t) => !t.lastError)
	const localTracks = db.query(`select count(id) from tracks`)
	const localErrors = db.query('select count(id) from tracks where last_error is not null')
	// const localDuplicates = db.query('select count(id) from tracks where json_array_length(files) > 1')
	console.log(`Downloading ${data.radio.name} to ${values.folder}/${values.slug}`, {
		localTracks: localTracks.values()[0][0],
		localErrors: localErrors.values()[0][0],
		// localDuplicates: localDuplicates.values()[0][0],
		remoteTracksInQuery: tracks.length,
		// missingTracks: tracks.length - Number(localTracks.values()[0][0]),
	})

	// if (values.deleteDuplicates) {
	// 	const tracks = db.query('select id, file from tracks where json_array_length(files) > 1').all()
	// 	for (const item of tracks) {
	// 		try {
	// 			console.log('Deleting', item)
	// 			await unlink('./' + item.file)
	// 		} catch (err) {
	// 			console.error('Failed to delete duplicate:', item.file, err)
	// 		} finally {
	// 			db.query('delete from tracks where id = $id').run({id: item.id})
	// 		}
	// 	}
	// 	console.log(`Deleted ${items.length} duplicate tracks`)
	// 	return
	// }

	if (values.debug) {
		console.log('exiting because debug', 'Would have processed', filteredTracks.length, 'tracks')
		process.exit(0)
	}

	if (!values.includeFailed) {
		console.log(
			`Processing ${filteredTracks.length} tracks (ignoring ${tracksWithError.length} previously unavailable tracks, use --includeFailed to include them)`,
		)
	} else {
		console.log(`Processing ${filteredTracks.length} tracks`)
	}

	const tracksFolder = `${folder}/tracks/`
	const glob = new Glob(`${tracksFolder}/*.m4a`)

	let current = 0
	for await (const t of filteredTracks) {
		current++
		const indexLog = `${current}/${filteredTracks.length}`

		db.query(
			`INSERT OR REPLACE INTO tracks (id, slug, created_at, updated_at, title, url, discogs_url, description, tags, mentions, provider, provider_id, downloaded, files, last_error) VALUES ($id, $slug, $created_at, $updated_at, $title, $url, $discogs_url, $description, $tags, $mentions, $provider, $providerId, $downloaded, $files, $lastError);`,
		).run({
			...t,
			tags: t.tags.join(','),
			mentions: t.mentions.join(','),
		})

		// Compare remote tracks with local files. Why actually? Can't we just check the sqlite? Or is the filesystem the real database :smirk:
		const filesWithSameProviderId = []
		for await (const file of glob.scan('.')) {
			if (t.providerId && file.includes(t.providerId)) {
				filesWithSameProviderId.push(file)
			}
		}
		db.query(`UPDATE tracks SET files = $files, downloaded = $downloaded WHERE id = $id;`).run({
			id: t.id,
			files: JSON.stringify(filesWithSameProviderId),
			downloaded: filesWithSameProviderId.length > 0 ? 1 : 0,
		})
		const fileExists = filesWithSameProviderId.length > 0
		if (!values.force && fileExists) continue

		try {
			const cleanTitle = filenamify(t.title, {replacement: ' ', maxLength: 255})
			const filename = `${tracksFolder}/${cleanTitle} [${t.providerId}]`
			await downloadAudio(t.url, `${filename}.%(ext)s`, t.description || t.url)
			// Mark as downloaded.
			console.log(indexLog, 'Downloaded', t.title)
			db.query(`UPDATE tracks SET downloaded = 1, last_error = $lastError, files = $files WHERE id = $id;`).run({
				id: t.id,
				lastError: null,
				files: `${filename}.m4a`,
			})
		} catch (err: unknown) {
			const error = err as ShellError
			// Mark as failed.
			const msg = `Failed to download audio: ${error.stderr.toString()}`
			console.log(indexLog, msg)
			db.query(`UPDATE tracks SET downloaded = 0, last_error = $lastError WHERE id = $id;`).run({
				id: t.id,
				files: null,
				lastError: msg,
			})
		}
	}
	console.log('Success')
	process.exit(0)
}

/** Downloads the audio from a URL (supported by yt-dlp) */
async function downloadAudio(url: string, filepath: string, metadataDescription: string) {
	return $`yt-dlp -f 'bestaudio[ext=m4a]' --no-playlist --restrict-filenames --output ${filepath} --parse-metadata "${metadataDescription}:%(meta_comment)s" --embed-metadata --quiet --progress ${url}`
}

/** Set up (or reuse) a local sqlite database */
async function setupDatabase(filename: string) {
	const db = new Database(filename, {
		strict: true,
	})
	db.exec('PRAGMA journal_mode = WAL;')
	db.run(`
		CREATE TABLE IF NOT EXISTS tracks  (
			id TEXT PRIMARY KEY,
			slug TEXT,
			title TEXT,
			description TEXT,
			url TEXT,
			discogs_url TEXT,
			provider TEXT,
			provider_id TEXT,
			created_at TEXT,
			updated_at TEXT,
			tags TEXT,
			mentions TEXT,
			downloaded INTEGER DEFAULT 0,
			last_error TEXT,
			files TEXT
		);`)
	return db
}
