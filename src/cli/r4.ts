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
	},
	strict: true,
	allowPositionals: true,
})
if (!values.slug) throw Error('Pass in `--slug <my-radio>` to select your channel')
if (!values.folder) throw Error('Pass in `--folder <path>` to decide where to store your radio')
main(values.slug, Number(values.limit), `${values.folder}/${values.slug}`)

/** Downloads all tracks from a radio */
async function main(slug: string, limit: number, folder: string) {
	// Make sure the folder exists (else commands will fail)
	await mkdir(folder, {recursive: true})

	// Create/connect the local Sqlite database.
	const db = await setupDatabase(`${folder}/${slug}.sqlite`)

	// Fetch remote radio + tracks.
	const {data, error} = await createBackup(slug, limit)
	if (error) throw error

	// Store the full response as a local file.
	await Bun.write(`${folder}/${slug}.json`, JSON.stringify(data, null, 2))

	// For each remote track, check if we tried (and failed) to download it previously.
	const tracks = data.tracks.map((t: Track) => {
		const q = db.query('select downloaded, files, last_error from tracks where id = $id;')
		const row = q.get({$id: t.id}) as Track
		t.downloaded = row?.downloaded
		t.files = row?.files
		t.lastError = row?.last_error
		return t
	})
	const tracksWithError = tracks.filter((t) => t.lastError)

	const localTracks = db.query(`select count(id) from tracks`)
	const localErrors = db.query('select count(id) from tracks where last_error is not null')
	const localDuplicates = db.query('select count(id) from tracks where json_array_length(files) > 1')

	console.log(`Downloading ${data.radio.name} to ${values.folder}/${values.slug}`, {
		localTracks: localTracks.values()[0][0],
		localErrors: localErrors.values()[0][0],
		localDuplicates: localDuplicates.values()[0][0],
		remoteTracks: tracks.length,
		missingTracks: tracks.length - Number(localTracks.values()[0][0]),
	})

	const filteredTracks = values.includeFailed ? tracks : tracks.filter((t) => !t.lastError)

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
			`INSERT OR REPLACE INTO tracks (id, slug, title, url, provider, provider_id, created_at, updated_at, last_error) VALUES ($id, $slug, $title, $url, $provider, $providerId, $createdAt, $updatedAt, $lastError);`,
		).run({
			$id: t.id,
			$slug: t.slug,
			$title: t.title,
			$url: t.url,
			$provider: t.provider,
			$providerId: t.providerId,
			$createdAt: t.createdAt,
			$updatedAt: t.updatedAt,
			$lastError: t.lastError,
		})

		// Compare remote tracks with local files. Why actually? Can't we just check the sqlite? Or is the filesystem the real database :smirk:
		const filesWithSameProviderId = []
		for await (const file of glob.scan('.')) {
			if (file.includes(t.providerId)) {
				filesWithSameProviderId.push(file)
			}
		}
		db.query(`UPDATE tracks SET files = $files WHERE id = $id;`).run({
			$id: t.id,
			$files: JSON.stringify(filesWithSameProviderId),
		})
		t.files = filesWithSameProviderId
		const cleanTitle = filenamify(t.title, {replacement: ' ', maxLength: 255})
		const filename = `${tracksFolder}/${cleanTitle} [${t.providerId}]`
		if (cleanTitle !== t.title) {
			// console.log('Changed title', t.title, '=>', cleanTitle)
		}
		const fileExists = await Bun.file(`${filename}.m4a`).exists()

		if (fileExists && !filesWithSameProviderId.length) {
			console.log('weeeird')
			return
		}

		if (filesWithSameProviderId.length > 1) {
			// has duplicates
		} else if (filesWithSameProviderId.length === 1) {
			// already downloaded
			// console.log(indexLog, 'Skipping track because it is already downloaded', t.title)
			// throw new Error(`Duplicates found for track id: ${t.id}`)
		}
		if (!values.force && (filesWithSameProviderId.length || fileExists)) {
			// console.log(indexLog, 'skipped - exists and force is deactivated', t.title)
			continue
		}

		try {
			try {
				await downloadAudio(t.url, `${filename}.%(ext)s`, t.description || t.url)
				// Mark as downloaded.
				console.log(indexLog, 'Downloaded', t.title)
				db.query(`UPDATE tracks SET downloaded = 1, last_error = $lastError WHERE id = $id;`).run({
					$id: t.id,
					$lastError: null,
				})
			} catch (err) {
				throw Error(`Failed to download audio: ${err.stderr.toString()}`)
			}
		} catch (err) {
			// Mark as failed.
			console.log(indexLog, err.message)
			db.query(`UPDATE tracks SET downloaded = 0, last_error = $error WHERE id = $id;`).run({
				$id: t.id,
				$error: err.message,
			})
		}
	}
}

/** Downloads the audio from a URL (supported by yt-dlp) */
async function downloadAudio(url: string, filepath: string, metadataDescription: string) {
	return $`yt-dlp -f 'bestaudio[ext=m4a]' --no-playlist --restrict-filenames --output ${filepath} --parse-metadata "${metadataDescription}:%(meta_comment)s" --embed-metadata --quiet --progress ${url}`
}

/** Set up (or reuse) a local sqlite database */
async function setupDatabase(filename: string) {
	const db = new Database(filename)
	db.exec('PRAGMA journal_mode = WAL;')
	db.run(
		`CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, slug TEXT, title TEXT, description TEXT, url TEXT, discogs_url TEXT, provider TEXT, provider_id TEXT, created_at TEXT, updated_at TEXT, tags TEXT, mentions TEXT, downloaded INTEGER DEFAULT 0, last_error TEXT, files TEXT);`,
	)
	return db
}
