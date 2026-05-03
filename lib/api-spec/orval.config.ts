import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

// Strip `/m/*` paths (caregiver mobile PWA) before zod codegen — those are
// hand-authored as zod in `lib/api-zod/src/m.ts` because orval-zod OOMs on
// their request/response schemas.
const stripMobilePathsTransformer: InputTransformerFn = (config) => {
  // Deep clone so we don't mutate the shared parsed OpenAPI object that
  // other inputs (api-client-react) may also read.
  const cloned = JSON.parse(JSON.stringify(config));
  cloned.info ??= {};
  cloned.info.title = "Api";
  if (cloned.paths) {
    for (const p of Object.keys(cloned.paths)) {
      if (p.startsWith("/m/")) delete cloned.paths[p];
    }
  }
  return cloned;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: stripMobilePathsTransformer,
      },
    },
    output: {
      workspace: path.resolve(apiZodSrc, "generated"),
      client: "zod",
      target: "./api.ts",
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          coerce: {
            query: ['boolean', 'number', 'string'],
            param: ['boolean', 'number', 'string'],
            body: ['bigint', 'date'],
            response: ['bigint', 'date'],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
