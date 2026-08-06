import EmptyState from './EmptyState';

/**
 * <Table columns={[{ key, label, align }]} rows={data} render={(row) => cells} />
 * or use the child-driven form:
 * <Table>
 *   <thead>…</thead>
 *   <tbody>…</tbody>
 * </Table>
 */
export default function Table({
  columns,
  rows = [],
  render,
  empty = null,
  dense = false,
  className = '',
  children,
}) {
  if (children) {
    return (
      <div className="oms-table-wrap">
        <table className={`oms-table ${dense ? 'oms-table--dense' : ''} ${className}`}>
          {children}
        </table>
      </div>
    );
  }

  if (rows.length === 0 && empty) {
    return <EmptyState {...empty} />;
  }

  return (
    <div className="oms-table-wrap">
      <table className={`oms-table ${dense ? 'oms-table--dense' : ''} ${className}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'oms-table__num' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? i}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'oms-table__num' : ''}>
                  {render ? render(row, c.key, c) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
