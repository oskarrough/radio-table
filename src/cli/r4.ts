import { $ } from 'bun'
import { Database } from 'bun:sqlite'
import { parseArgs } from 'util'
import filenamify from 'filenamify/browser'
import {createBackup, fetchTracks} from '../utils.ts'

import type { Track } from '../schema'

async function downloadTrack(track: Track, folder: string) {
  const title = filenamify(track.title, { replacement: ' ', maxLength: 255 })
  const filepath = `${folder}/${title}`
  // When a file already exists, by default yt-dlp will skip the download but it will still refresh metadata.
  // This is slow, so we skip completely here. @todo make option to force download.
  const maybeFilename = `${filepath} [${track.providerId}].m4a`
  const fileExists = await Bun.file(maybeFilename).exists()
  if (fileExists) {
    return Promise.resolve('fileExists')
  }
  try {
    return await downloadAudio(track.url, `${filepath} [%(id)s].%(ext)s`, track.description || track.url)
  } catch (err) {
    throw Error(`Failed to download audio: ${err.stderr.toString()}`)
    // console.log(err.stdout.toString())
    // console.log(err.stderr.toString())
    // throw err
  }
}

/** Downloads the audio from a URL (supported by yt-dlp) */
async function downloadAudio(url: string, filepath: string, metadataDescription: string) {
  return $`yt-dlp -f 'bestaudio[ext=m4a]' --no-playlist --restrict-filenames --output ${filepath} --parse-metadata "${metadataDescription}:%(meta_comment)s" --embed-metadata --quiet ${url}`
}

/** Downloads all tracks from a radio */
async function main() {
  const db = new Database(`${values.slug}.sqlite`)
  db.exec('PRAGMA journal_mode = WAL;')
  db.run(
    `CREATE TABLE IF NOT EXISTS tracks (id TEXT PRIMARY KEY, slug TEXT, title TEXT, url TEXT, provider TEXT, providerId TEXT, downloaded INTEGER DEFAULT 0, lastError TEXT);`,
  )
  const query = db.query(`SELECT count(id) as total FROM tracks`)
  const objects = query.get()
  console.log(objects.total, 'tracks in local database')

  // db.run('delete from tracks;')

  const { data, error } = await createBackup(values.slug)
  if (error) return console.error(error)

  console.log(data)

  // Check if we have recorded an error for this track previously.
  const tracks = data.tracks.map((t: Track) => {
    const q = db.query('select lastError from tracks where id = $id;')
    const row = q.get({ $id: t.id })
    t.lastError = row?.lastError
    return t
  })

  const noMedia = tracks.filter((t) => t.lastError)

  console.log(`Found radio: ${data.radio.name}`, {
    working: tracks.length - noMedia.length,
    failing: noMedia.length,
    total: tracks.length,
  })
  if (!values.folder) {
    console.log('Use --folder to get all working tracks')
    console.log('Use --includeFailed to also download tracks that previously failed to do so')
    return
  }

  const filteredTracks = values.includeFailed ? tracks : tracks.filter((t) => !t.lastError)
  if (values.includeFailed) {
    console.log('Processing tracks (including previously failed)', filteredTracks.length)
  } else {
    console.log('Processing tracks (skipping previously failed)', filteredTracks.length)
  }
  // let current = 0
  for await (const t of filteredTracks) {
    // current++
    // console.log(`Processing ${current}/${filteredTracks.length}`)
    const insertTrack = db.query(
      `INSERT OR REPLACE INTO tracks (id, slug, title, url, provider, providerId) VALUES ($id, $slug, $title, $url, $provider, $providerId);`,
    )
    insertTrack.run({
      $id: t.id,
      $slug: t.slug,
      $title: t.title,
      $url: t.url,
      $provider: t.provider,
      $providerId: t.providerId,
    })
    try {
      const x = await downloadTrack(t, values.folder)
      if (x === 'fileExists') {
        // console.log('Downloaded (file exists)')
      } else {
        console.log('Downloaded', t.title)
      }
      // Mark as downloaded.
      db.query(`UPDATE tracks SET downloaded = 1 WHERE id = $id;`).run({
        $id: t.id,
      })
    } catch (err) {
      // Mark as failed.
      db.query(`UPDATE tracks SET downloaded = 0, lastError = $error WHERE id = $id;`).run({
        $id: t.id,
        $error: err.message,
      })
    }
  }
}

// Get CLI arguments (only strings + booleans)
const { values, positionals } = parseArgs({
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
  },
  strict: true,
  allowPositionals: true,
})

console.log('cli values', values)
console.log('cli positionals', positionals)


if (!values.slug) throw Error('Pass in `--slug oskar` to download the radio')
// main()
const { data, error } = await createBackup(values.slug, Number(values.limit))
if (error) console.log(error)
console.log(data.radio.name, data.tracks.length)
