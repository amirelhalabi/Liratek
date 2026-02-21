# Voucher Images

Place voucher images in this folder for display in the Recharge module.

## Naming Convention

Images are matched by **provider** and **amount** (USD):

```
{provider}-{amount}.png
```

### Examples

| File name      | Provider | Amount |
| -------------- | -------- | ------ |
| `mtc-5.png`    | MTC      | $5     |
| `mtc-10.png`   | MTC      | $10    |
| `mtc-15.png`   | MTC      | $15    |
| `mtc-20.png`   | MTC      | $20    |
| `mtc-25.png`   | MTC      | $25    |
| `mtc-30.png`   | MTC      | $30    |
| `mtc-50.png`   | MTC      | $50    |
| `mtc-100.png`  | MTC      | $100   |
| `alfa-5.png`   | Alfa     | $5     |
| `alfa-10.png`  | Alfa     | $10    |
| `alfa-15.png`  | Alfa     | $15    |
| `alfa-20.png`  | Alfa     | $20    |
| `alfa-25.png`  | Alfa     | $25    |
| `alfa-30.png`  | Alfa     | $30    |
| `alfa-50.png`  | Alfa     | $50    |
| `alfa-100.png` | Alfa     | $100   |

### Fallback Images

If a specific amount image is missing, the app will look for a generic provider image:

| File name  | Used for                                 |
| ---------- | ---------------------------------------- |
| `mtc.png`  | Any MTC amount without a specific image  |
| `alfa.png` | Any Alfa amount without a specific image |

### Supported Formats

PNG, JPG, JPEG, WebP. Recommended size: 200×120px or similar landscape ratio.
