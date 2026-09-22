import { useState } from 'react'
import { copyText, shortHash } from '../../lib/formatting/display'
export function HashValue({ value }: { value: string }) { const [copied, setCopied] = useState(false); const copy = async () => { await copyText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }; return <span className="hash" title={value}><code>{shortHash(value)}</code><button aria-label="Copy full hash" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button></span> }
