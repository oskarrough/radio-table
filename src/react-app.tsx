import React from 'react'
import ReactDOM from 'react-dom/client'
import TheTable from './the-table.tsx'
import {createBackup} from './utils.ts'
import {hello} from './sqlite-browser.ts'
import './index.css'

async function main() {
	// await hello()
	// await setupSQLite()

	const {data, error} = await createBackup('oskar')
	if (error) {
		console.error(error)
		throw new Error('Failed to fetch backup')
	}

	ReactDOM.createRoot(document.getElementById('radio-table-react')!).render(
		<React.StrictMode>
			<TheTable store={data} />
		</React.StrictMode>,
	)
}

main()
