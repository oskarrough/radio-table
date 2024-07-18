
export interface TrackR4 {
	// from supabase schema
	id: string
	created_at: string
	updated_at: string
	title: string
	url: string
	discogs_url?: string
	description?: string
	tags?: string[]
	mentions?: string[]
	// from channel_tracks view
	slug: string
}

export type Track = Omit<TrackR4, 'tags' | 'mentions'> & {
	tags?: string
	mentions?: string
	// custom ones
	files?: string
	lastError?: string
	provider?: string
	providerId?: string
}

export interface Channel {
	coordinates: unknown | null
	created_at: string | null
	description: string | null
	favorites: string[] | null
	firebase_id: string | null
	followers: string[] | null
	fts: unknown | null
	id: string
	image: string | null
	latitude: number | null
	longitude: number | null
	name: string
	slug: string
	updated_at: string | null
	url: string | null
}

export const TrackTableSchema = `
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
		last_error TEXT,
		files TEXT
	);`
