# Scripts

## Advanced Usage

### Set Podley Dependencies to a Specific Version

```bash
 ./scripts/set-podley-deps-to-version.js 0.0.1
```

### Link Podley Dependencies

If you are developing in the podley repo, you can link the podley dependencies to the local version. This way you do not have to publish the podley dependencies to npm in order to use them here.

In the podley repo, run:

```bash
./scripts/link-all.sh
```

In this repo, run:

```bash
 ./scripts/link-podley-deps.js
```
