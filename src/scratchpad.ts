// store a backup of the response, because why not
// await Bun.write(`${folder}/${slug}.json`, JSON.stringify(data, null, 2))
// console.log('saved remote backup to disk', `${folder}/${slug}.json`)

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
// 	const q = db.query('select files, lastError as lastError from tracks where id = $id;')
// 	const row = q.get({id: t.id}) as Track
// 	return {...t, files: row?.files, lastError: row?.lastError}
// }) as Track[]

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
