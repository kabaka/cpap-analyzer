import { describe, it, expect } from 'vitest';
import { render } from '@test/test-utils';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';

describe('Table', () => {
  it('should render table structure (thead, tbody, tr, th, td)', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>AHI</TableCell>
            <TableCell>3.2</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(container.querySelector('table')).toBeInTheDocument();
    expect(container.querySelector('thead')).toBeInTheDocument();
    expect(container.querySelector('tbody')).toBeInTheDocument();
    expect(container.querySelectorAll('tr')).toHaveLength(2);
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('should render correct data in cells', () => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>AHI</TableCell>
            <TableCell>3.2</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Leak</TableCell>
            <TableCell>12.5</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    const cells = container.querySelectorAll('td');
    expect(cells[0]?.textContent).toBe('AHI');
    expect(cells[1]?.textContent).toBe('3.2');
    expect(cells[2]?.textContent).toBe('Leak');
    expect(cells[3]?.textContent).toBe('12.5');
  });

  it('should apply custom className to table', () => {
    const { container } = render(
      <Table className="custom-table">
        <TableBody>
          <TableRow>
            <TableCell>Data</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(container.querySelector('table')?.className).toContain('custom-table');
  });

  it('should render multiple rows in tbody', () => {
    const data = [
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
      { name: 'C', value: '3' },
    ];

    const { container } = render(
      <Table>
        <TableBody>
          {data.map((row) => (
            <TableRow key={row.name}>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>,
    );

    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  });
});
