import { describe, expect, it } from "vitest";
import { operatorFieldsSchema } from "./schema.js";

const square = (x: number) => [{ x, y: 0 }, { x: x + 0.4, y: 0 }, { x: x + 0.4, y: 1 }, { x, y: 1 }];
const zones = [{ id: "a", label: "A", points: square(0) }, { id: "b", label: "B", points: square(0.6) }];

describe("operatorFields counterLabel", () => {
  it("keeps a counter name and rejects an empty one", () => {
    expect(operatorFieldsSchema.parse({ zones, total: 12, counterLabel: "Spiegel-Server" }).counterLabel).toBe("Spiegel-Server");
    expect(operatorFieldsSchema.safeParse({ zones, counterLabel: " " }).success).toBe(false);
    expect(operatorFieldsSchema.parse({ zones }).counterLabel).toBeUndefined();
  });
});
