import {z} from 'zod'

/**
	These schemas exist for runtime (and type) validations. Unfortunately we have three different tracks.
	Why are they different, you might ask. Good question. One reason is that SQLite and PostgreSQL aren't compatible, sqlite has no string[] column, for example.

	Another reason is that it's good exercise to handle different schemas. I'd also want to sync to Matrix, not just Radio4000 v2.

	Track = for use in the app
	LocalTrack = for storing in the local SQLite database
	RemoteTrack = for fetching from the remote Radio4000 v2 API
*/

const BaseTrackSchema = z.object({
	id: z.string(),
	createdAt: z.string().datetime({offset: true}),
	updatedAt: z.string().datetime({offset: true}).optional(),
	slug: z.string(),
	url: z.string().url(),
	title: z.string(),
	description: z.string().nullable(),
	discogsUrl: z.string().url().optional().or(z.string().nullable()),
	files: z.string().optional().nullable(),
	lastError: z.string().optional().nullable(),
	provider: z.string().optional().nullable(),
	providerId: z.string().optional().nullable(),
})

export const TrackSchema = BaseTrackSchema.extend({
	tags: z.array(z.string()).optional(),
	mentions: z.array(z.string()).optional(),
})
export type Track = z.infer<typeof TrackSchema>

export const LocalTrackSchema = TrackSchema.extend({
	tags: z.string().optional(),
	mentions: z.string().optional(),
})
export type LocalTrack = z.infer<typeof LocalTrackSchema>

export const RemoteTrackSchema = z.object({
	...TrackSchema.omit({
		createdAt: true,
		updatedAt: true,
		discogsUrl: true,
		provider: true,
		providerId: true,
		files: true,
		lastError: true,
	}).shape,
	created_at: z.string(),
	updated_at: z.string().optional(),
	discogs_url: z.string().url().optional(),
})
export type RemoteTrack = z.infer<typeof RemoteTrackSchema>

export const TrackTableSchema = `
	CREATE TABLE IF NOT EXISTS tracks  (
		id TEXT PRIMARY KEY,
		createdAt TEXT,
		updatedAt TEXT,
		slug TEXT,
		url TEXT,
		title TEXT,
		description TEXT,
		tags TEXT,
		mentions TEXT,
		discogsUrl TEXT,
		files TEXT,
		lastError TEXT,
		provider TEXT,
		providerId TEXT
	);`
