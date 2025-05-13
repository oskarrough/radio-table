import {parseArgs} from 'util'

/** Get CLI arguments (only strings + booleans) */
export default function parseArguments() {
	const {values} = parseArgs({
		// eslint-disable-next-line no-undef
		args: Bun.argv,
		options: {
			simulate: {
				type: 'boolean',
			},
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
			downloadFailed: {
				type: 'boolean',
			},
			pull: {
				type: 'boolean',
			},
			download: {
				type: 'boolean',
			},
		},
		strict: true,
		allowPositionals: true,
	})

	return values
}
