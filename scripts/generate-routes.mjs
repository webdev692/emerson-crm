import { Generator, getConfig } from '@tanstack/router-generator'
import process from 'node:process'

const root = process.cwd()
await new Generator({ config: getConfig({}, root), root }).run()
