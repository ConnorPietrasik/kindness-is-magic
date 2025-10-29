import {
  Container,
  EmptyState,
  Flex,
  Heading,
  Table,
  VStack,
} from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { FiSearch } from "react-icons/fi"
import { z } from "zod"

import { FamilyMembersService } from "@/client"
import { FamilyMemberActionsMenu } from "@/components/Common/FamilyMemberActionsMenu"
import AddFamilyMember from "@/components/FamilyMembers/AddFamilyMember"
import PendingFamilyMembers from "@/components/Pending/PendingFamilyMembers"
import {
  PaginationItems,
  PaginationNextTrigger,
  PaginationPrevTrigger,
  PaginationRoot,
} from "@/components/ui/pagination.tsx"

const family_membersSearchSchema = z.object({
  page: z.number().catch(1),
})

const PER_PAGE = 5

function getFamilyMembersQueryOptions({ page }: { page: number }) {
  return {
    queryFn: () =>
      FamilyMembersService.readFamilyMembers({ skip: (page - 1) * PER_PAGE, limit: PER_PAGE }),
    queryKey: ["family_members", { page }],
  }
}

export const Route = createFileRoute("/_layout/family-members")({
  component: FamilyMembers,
  validateSearch: (search) => family_membersSearchSchema.parse(search),
})

function FamilyMembersTable() {
  const navigate = useNavigate({ from: Route.fullPath })
  const { page } = Route.useSearch()

  const { data, isLoading, isPlaceholderData } = useQuery({
    ...getFamilyMembersQueryOptions({ page }),
    placeholderData: (prevData) => prevData,
  })

  const setPage = (page: number) => {
    navigate({
      to: "/family-members",
      search: (prev) => ({ ...prev, page }),
    })
  }

  const family_members = data?.data.slice(0, PER_PAGE) ?? []
  const count = data?.count ?? 0

  if (isLoading) {
    return <PendingFamilyMembers />
  }

  if (family_members.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Content>
          <EmptyState.Indicator>
            <FiSearch />
          </EmptyState.Indicator>
          <VStack textAlign="center">
            <EmptyState.Title>You don't have any family members yet</EmptyState.Title>
            <EmptyState.Description>
              Add a new family member to get started
            </EmptyState.Description>
          </VStack>
        </EmptyState.Content>
      </EmptyState.Root>
    )
  }

  return (
    <>
      <Table.Root size={{ base: "sm", md: "md" }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader w="sm">ID</Table.ColumnHeader>
            <Table.ColumnHeader w="sm">Title</Table.ColumnHeader>
            <Table.ColumnHeader w="sm">Description</Table.ColumnHeader>
            <Table.ColumnHeader w="sm">Actions</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {family_members?.map((family_member) => (
            <Table.Row key={family_member.id} opacity={isPlaceholderData ? 0.5 : 1}>
              <Table.Cell truncate maxW="sm">
                {family_member.id}
              </Table.Cell>
              <Table.Cell truncate maxW="sm">
                {family_member.title}
              </Table.Cell>
              <Table.Cell
                color={!family_member.description ? "gray" : "inherit"}
                truncate
                maxW="30%"
              >
                {family_member.description || "N/A"}
              </Table.Cell>
              <Table.Cell>
                <FamilyMemberActionsMenu family_member={family_member} />
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      <Flex justifyContent="flex-end" mt={4}>
        <PaginationRoot
          count={count}
          pageSize={PER_PAGE}
          onPageChange={({ page }) => setPage(page)}
        >
          <Flex>
            <PaginationPrevTrigger />
            <PaginationItems />
            <PaginationNextTrigger />
          </Flex>
        </PaginationRoot>
      </Flex>
    </>
  )
}

function FamilyMembers() {
  return (
    <Container maxW="full">
      <Heading size="lg" pt={12}>
        FamilyMembers Management
      </Heading>
      <AddFamilyMember />
      <FamilyMembersTable />
    </Container>
  )
}
