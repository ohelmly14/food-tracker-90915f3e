# recipe/v1 import format

The Food Tracker app has no server. Recipes are imported on-device via the **Import** screen
(paste JSON, pick a `.json` file, drag-drop) or a link: `<app-url>#/import?data=<base64url(JSON)>`.

A payload is **one recipe object or an array** of them.

| field | required | type | notes |
|---|---|---|---|
| `schema` | yes | `"recipe/v1"` | |
| `source` | yes | string | e.g. `"cook-bot"`. Used for per-source auto-approve. |
| `external_id` | yes | string | `(source, external_id)` is the idempotency key: re-import updates, never duplicates. |
| `name` | yes | string | |
| `portions` | yes | number > 0 | |
| `cooked_weight_g` | no | number > 0 | Defaults to sum of ingredient grams. |
| `ingredients` | yes | non-empty array | see below |
| `ingredients[].name` | yes | string | Matched to existing foods case/whitespace-insensitively. |
| `ingredients[].grams` | yes | number > 0 | |
| `ingredients[].text` | no | string | Original line, shown in the app. |
| `ingredients[].barcode` | no | string or null | Matched first. |
| `ingredients[].nutrition_per_100g` | no | `{calories,protein,carbs,fat,fiber}` | Used to create a new food (flagged imported) when no match. |
| `nutrition_per_portion` | no | same shape | Fallback if some ingredient has no match and no nutrition. |
| `instructions` | no | string[] | |
| `tags` | no | string[] | |
| `image_url` | no | string or null | |

Matching order per ingredient: barcode → normalized name → new imported food from `nutrition_per_100g`.
If an ingredient cannot be resolved and `nutrition_per_portion` is missing, that recipe fails with an error
naming the ingredient path; other recipes in the array still import.

Imported recipes land in the **Imported inbox** (`status: inbox`) and are hidden from search until approved,
unless the source is set to auto-approve in Settings. Validation errors are reported per field, e.g.
`[1].ingredients[0].grams: required positive number`.

## Sample

See [`recipe-v1.sample.json`](recipe-v1.sample.json) (also downloadable inside the app on the Import screen).

```json
{
  "schema": "recipe/v1",
  "source": "cook-bot",
  "external_id": "chili-2026-11-02",
  "name": "Turkey chili",
  "portions": 6,
  "cooked_weight_g": 1800,
  "ingredients": [
    {
      "text": "500 g ground turkey",
      "name": "Ground turkey, 93% lean",
      "grams": 500,
      "barcode": null,
      "nutrition_per_100g": {
        "calories": 150,
        "protein": 21,
        "carbs": 0,
        "fat": 7,
        "fiber": 0
      }
    },
    {
      "text": "2 cans kidney beans, drained",
      "name": "Kidney beans, canned, drained",
      "grams": 480,
      "barcode": null,
      "nutrition_per_100g": {
        "calories": 127,
        "protein": 8.7,
        "carbs": 22.8,
        "fat": 0.5,
        "fiber": 6.4
      }
    },
    {
      "text": "1 can crushed tomatoes",
      "name": "Crushed tomatoes, canned",
      "grams": 800,
      "barcode": null,
      "nutrition_per_100g": {
        "calories": 32,
        "protein": 1.6,
        "carbs": 7,
        "fat": 0.3,
        "fiber": 1.9
      }
    },
    {
      "text": "1 onion",
      "name": "Onion",
      "grams": 150,
      "barcode": null,
      "nutrition_per_100g": {
        "calories": 40,
        "protein": 1.1,
        "carbs": 9.3,
        "fat": 0.1,
        "fiber": 1.7
      }
    }
  ],
  "nutrition_per_portion": {
    "calories": 420,
    "protein": 38,
    "carbs": 35,
    "fat": 12,
    "fiber": 9
  },
  "instructions": [
    "Brown the turkey with the onion.",
    "Add beans and tomatoes, simmer 30 minutes."
  ],
  "tags": [
    "dinner"
  ],
  "image_url": null
}
```

Building a link (Node): `"#/import?data=" + Buffer.from(JSON.stringify(recipe)).toString("base64url")`
