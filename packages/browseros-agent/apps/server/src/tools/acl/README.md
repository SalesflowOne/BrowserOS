# ACL Scorer Reference

This folder now contains reference-only ACL scoring code. BrowserOS no longer exposes ACL rule UI, APIs, shared contracts, or production tool enforcement. Nothing in the server runtime should import or call the scorer.

## How it works

`acl-scorer.ts` can still score a captured element fixture against rule-like inputs using the old matching pipeline:

1. **Site filtering** — rules are filtered to those matching the current page URL
2. **Site-only rules** — rules with no selector/text/description block the entire site immediately
3. **Element scoring** — remaining rules are scored against the element using three signals:

| Signal | Weight | How it works |
|--------|--------|-------------|
| Exact | 25% | Are any compiled rule terms a substring of an element field? |
| Fuzzy | 25% | Edit distance ratio between rule terms and element text windows |
| Semantic | 50% | Cosine similarity of sentence embeddings (BAAI/bge-small-en-v1.5 via ONNX) |

The weighted scores produce a **confidence** value between 0 and 1. If confidence >= **0.4**, the scorer marks the fixture decision as blocked. This is only a reference decision, not runtime enforcement.

## Files

| File | Purpose |
|------|---------|
| `acl-scorer.ts` | Reference pipeline: local ACL-like types, site pattern matching, feature extraction, scoring, decision |
| `acl-embeddings.ts` | Lazy-loaded `@huggingface/transformers` pipeline for semantic similarity |
| `acl-edit-distance.ts` | Levenshtein edit distance ratio for fuzzy matching |
| `acl-stopwords.ts` | Static set of 198 English stopwords (from NLTK corpus) |

## Embedding model

The semantic scoring uses [BAAI/bge-small-en-v1.5](https://huggingface.co/BAAI/bge-small-en-v1.5) (~33MB ONNX model) via `@huggingface/transformers`. The model downloads automatically on first use and is cached for the process lifetime.

Override the model with the `ACL_EMBEDDING_MODEL` environment variable (e.g. `ACL_EMBEDDING_MODEL=Xenova/bge-base-en-v1.5`).

## Testing

```bash
bun --env-file=apps/server/.env.development test apps/server/tests/tools/acl-scorer.test.ts
```
