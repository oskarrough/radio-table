
async function pull(slug: string) {
	const {data, error} = await createBackup(slug)
	if (error || !data) {
		console.error(error)
		process.exit(0)
	}
	const remoteTracks = data.tracks
	console.log('pulled remote tracks', remoteTracks.length)
	console.log(data.tracks[0])
	// console.log(TrackSchema.parse(remoteTrackToTrack(data.tracks[0])))
	// console.log(LocalTrackSchema.parse(trackToLocalTrack(remoteTrackToTrack(data.tracks[0]))))

	// const remoteTrack =  RemoteTrackSchema.parse(data.tracks[0])
	// const track = remoteTrackToTrack(remoteTrack)
	// const localTrack = trackToLocalTrack(track)
	// console.log({remoteTrack, track, localTrack})

	// store a backup of the response, because why not
	await Bun.write(`${folder}/${slug}.json`, JSON.stringify(data, null, 2))
	console.log('saved remote backup to disk', `${folder}/${slug}.json`)
	// merge remote into the local tracks
	// for (const remote of data.tracks.slice(0, 3)) {
	// const local = db.query('select * from tracks where id = $id;').get({id: remote.id}) as LocalTrack
	// const track = local ? {...local, ...t} : t
	// console.log(R.difference(Object.keys(local), Object.keys(remote)))
	// console.log(diffObjects(local, remote))
	// upsertLocalTrack(track)
	// }
	// t.files = JSON.stringify(filesWithSameProviderId)
	// data.tracks.map(serialize).forEach(upsertLocalTrack)
	// 4. Re-use local data, if we already processed some of the remote tracks.
	// const tracks = data.tracks.map((t) => {
	// 	const q = db.query('select files, last_error as lastError from tracks where id = $id;')
	// 	const row = q.get({id: t.id}) as Track
	// 	return {...t, files: row?.files, lastError: row?.lastError}
	// }) as Track[]
}


// now we could sync remote to local db?
// const tracksToPull = normalTracks.filter((t) => !localTracks.find((lt) => lt.id === t.id))
// console.log(`Tracks to insert locally: ${tracksToPull.length}`)

// console.log('before', normalTracks[0])
// const what = trackToLocalTrack(normalTracks[0])
// console.log('after', what)
// insertOrReplaceLocalTrack(db, normalTracks[0])

// tracksToPull.forEach(t => {
// 	try {
// 		// const localTrack = trackToLocalTrack(t)
// 		// console.log('would insert', localTrack)
// 		// insertOrReplaceLocalTrack(db, localTrack)
// 	} catch (err) {
// 		// console.log()
// 		// console.log(err)
// 	}
// })

// logStatus()
// await pull(slug)
// logStatus()
// process.exit(1)

async function helloworld() {
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

	const tracksWithError = localTracks.filter((t) => t.lastError)
	const filteredTracks = values.includeFailed ? localTracks : localTracks.filter((t) => !t.lastError)

	if (values.debug) {
		console.log('Exiting because debug flag is set')
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

		// Compare remote tracks with local files. Why actually? Can't we just check the sqlite? Or is the filesystem the real database :smirk:
		const filesWithSameProviderId = []
		for await (const file of glob.scan('.')) {
			if (t.providerId && file.includes(t.providerId)) {
				filesWithSameProviderId.push(file)
			}
		}
		t.files = JSON.stringify(filesWithSameProviderId)
		db.query(
			`INSERT OR REPLACE INTO tracks (id, slug, created_at, updated_at, title, url, discogs_url, description, tags, mentions, provider, provider_id, files, last_error) VALUES ($id, $slug, $created_at, $updated_at, $title, $url, $discogs_url, $description, $tags, $mentions, $provider, $providerId, $files, $lastError);`,
		).run({
			...t,
		})

		const fileExists = filesWithSameProviderId.length > 0
		if (!values.force && fileExists) continue

		try {
			const cleanTitle = filenamify(t.title, {replacement: ' ', maxLength: 255})
			const filename = `${tracksFolder}/${cleanTitle} [${t.providerId}]`
			await downloadAudio(t.url, `${filename}.%(ext)s`, t.description || t.url)
			console.log(indexLog, 'Downloaded', t.title)
			db.query(`UPDATE tracks SET last_error = $lastError, files = $files WHERE id = $id;`).run({
				id: t.id,
				files: `${filename}.m4a`,
				lastError: null,
			})
		} catch (err: unknown) {
			const error = err as ShellError
			const msg = `Error downloading audio: ${error.stderr.toString()}`
			console.log(indexLog, msg)
			db.query(`UPDATE tracks SET files = $files, last_error = $lastError WHERE id = $id;`).run({
				id: t.id,
				files: null,
				lastError: msg,
			})
		}
	}
}

function logStatus() {
	console.log('local tracks', localTracks.length)
	// console.log('remote tracks', remoteTracks.length)
	// if (!data) return
	// const remoteTracks = data.tracks
	// console.log('remote tracks', remoteTracks.length)
	// console.log(remoteTracks.length - localTracks.length, 'tracks to pull')
	// const localDuplicates = db.query('select count(id) from tracks where json_array_length(files) > 1')
	// console.log(`Downloading ${data.radio.name} to ${values.folder}/${values.slug}`, {
	// 	localTracks: db.query(`select count() from tracks`).values()[0][0],
	// 	localErrors: db.query('select count() from tracks where last_error is not null').values()[0][0],
	// 	// localDuplicates: localDuplicates.values()[0][0],
	// 	remoteTracksQueried: tracks.length,
	// 	// missingTracks: tracks.length - Number(localTracks.values()[0][0]),
	// })
}
