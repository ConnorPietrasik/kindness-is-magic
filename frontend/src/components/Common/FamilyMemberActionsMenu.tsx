import { IconButton } from "@chakra-ui/react"
import { BsThreeDotsVertical } from "react-icons/bs"
import type { FamilyMemberPublic } from "@/client"
import DeleteFamilyMember from "../FamilyMembers/DeleteFamilyMember"
import EditFamilyMember from "../FamilyMembers/EditFamilyMember"
import { MenuContent, MenuRoot, MenuTrigger } from "../ui/menu"

interface FamilyMemberActionsMenuProps {
  family_member: FamilyMemberPublic
}

export const FamilyMemberActionsMenu = ({ family_member }: FamilyMemberActionsMenuProps) => {
  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <IconButton variant="ghost" color="inherit">
          <BsThreeDotsVertical />
        </IconButton>
      </MenuTrigger>
      <MenuContent>
        <EditFamilyMember family_member={family_member} />
        <DeleteFamilyMember id={family_member.id} />
      </MenuContent>
    </MenuRoot>
  )
}
