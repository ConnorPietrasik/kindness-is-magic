import { Table } from "@chakra-ui/react"
import { SkeletonText } from "../ui/skeleton"

const PendingItems = () => (
  <Table.Root size={{ base: "sm", md: "md" }}>
    <Table.Header>
      <Table.Row>
        <Table.ColumnHeader w="sm">Name</Table.ColumnHeader>
        <Table.ColumnHeader w="sm">Age</Table.ColumnHeader>
        <Table.ColumnHeader w="sm">Family Role</Table.ColumnHeader>
        <Table.ColumnHeader w="sm">Practical Wish</Table.ColumnHeader>
        <Table.ColumnHeader w="sm">Fun Wish</Table.ColumnHeader>
        <Table.ColumnHeader w="sm">Note</Table.ColumnHeader>
        <Table.ColumnHeader w="sm">Actions</Table.ColumnHeader>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {[...Array(5)].map((_, index) => (
        <Table.Row key={index}>
          <Table.Cell>
            <SkeletonText noOfLines={1} />
          </Table.Cell>
          <Table.Cell>
            <SkeletonText noOfLines={1} />
          </Table.Cell>
          <Table.Cell>
            <SkeletonText noOfLines={1} />
          </Table.Cell>
          <Table.Cell>
            <SkeletonText noOfLines={1} />
          </Table.Cell>
          <Table.Cell>
            <SkeletonText noOfLines={1} />
          </Table.Cell>
          <Table.Cell>
            <SkeletonText noOfLines={1} />
          </Table.Cell>
          <Table.Cell>
            <SkeletonText noOfLines={1} />
          </Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table.Root>
)

export default PendingItems
