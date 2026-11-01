import type { TableSpec } from "../charts/DataTable";
import { categoryValues } from "../charts/specs/bars";
import { rowsOf } from "../data/arrow";
import { amountCell } from "../format/cells";
import { revenueByRegion } from "../prototype/fixtures";

const table = revenueByRegion();
export const categories = categoryValues(table, "region", "ca_net");
export const selectedKeys = ["Occitanie"];
export const tableSpec: TableSpec = {
  caption: "CA net par région", rowKey: "region", selectedKeys,
  columns: [{ key: "region", label: "Région" }, { key: "ca_net", label: "CA net", numeric: true, format: amountCell }],
  rows: rowsOf(table, ["region", "ca_net"]),
};
