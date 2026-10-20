Real anonymized producer files only. JOED adds the JSON after Amy's paper-proof
sign-off; synthetic fixtures stay in the parent directory.

Run `node scripts/anonymize-results.mjs <private-input.json> <new-output.json>`
outside this directory, then `node scripts/anonymize-results.mjs --check
<new-output.json>` before copying only the output here. Output files are 0600;
an existing output is refused. Never commit raw inputs or identity mappings.

The Node contract suite validates every file here and requires canonical
anonymous tokens. P4 automatically renders these same files at 1440 and 390,
light and dark, with the synthetic fixtures' model and accessibility checks.
