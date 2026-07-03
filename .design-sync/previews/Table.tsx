import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from 'cpap-analyzer';

export const NightlySummary = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>Date</TableHead>
        <TableHead>AHI</TableHead>
        <TableHead>Usage (h)</TableHead>
        <TableHead>Leak 95% (L/min)</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell>Jul 1</TableCell>
        <TableCell>3.2</TableCell>
        <TableCell>7.4</TableCell>
        <TableCell>12</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Jul 2</TableCell>
        <TableCell>5.1</TableCell>
        <TableCell>6.9</TableCell>
        <TableCell>18</TableCell>
      </TableRow>
      <TableRow>
        <TableCell>Jul 3</TableCell>
        <TableCell>2.8</TableCell>
        <TableCell>8.1</TableCell>
        <TableCell>9</TableCell>
      </TableRow>
    </TableBody>
  </Table>
);
