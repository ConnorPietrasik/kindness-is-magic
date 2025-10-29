import {
  Button,
  ButtonGroup,
  DialogActionTrigger,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type SubmitHandler, useForm } from "react-hook-form"
import { FaExchangeAlt } from "react-icons/fa"

import { type ApiError, type FamilyMemberPublic, FamilyMembersService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog"
import { Field } from "../ui/field"

interface EditFamilyMemberProps {
  family_member: FamilyMemberPublic
}

interface FamilyMemberUpdateForm {
  given_name?: string
  age: number
  practical_wish?: string
  fun_wish?: string
  note?: string
}

const EditFamilyMember = ({ family_member }: EditFamilyMemberProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FamilyMemberUpdateForm>({
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      ...family_member,
      given_name: family_member.given_name ?? undefined,
      age: family_member.age ?? 0,
      practical_wish: family_member.practical_wish ?? "",
      fun_wish: family_member.fun_wish ?? "",
      note: family_member.fun_wish ?? ""
    },
  })

  const mutation = useMutation({
    mutationFn: (data: FamilyMemberUpdateForm) =>
      FamilyMembersService.updateFamilyMember({ id: family_member.id, requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Family member updated successfully.")
      reset()
      setIsOpen(false)
    },
    onError: (err: ApiError) => {
      handleError(err)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["family_members"] })
    },
  })

  const onSubmit: SubmitHandler<FamilyMemberUpdateForm> = async (data) => {
    mutation.mutate(data)
  }

  return (
    <DialogRoot
      size={{ base: "xs", md: "md" }}
      placement="center"
      open={isOpen}
      onOpenChange={({ open }) => setIsOpen(open)}
    >
      <DialogTrigger asChild>
        <Button variant="ghost">
          <FaExchangeAlt fontSize="16px" />
          Edit Family Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Edit Family Member</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Text mb={4}>Update the family member details below.</Text>
            <VStack gap={4}>
              
              <Field
                required
                invalid={!!errors.given_name}
                errorText={errors.given_name?.message}
                label="Given Name"
              >

                <Input
                  {...register("given_name", {
                    required: "Name is required.",
                  })}
                  placeholder="Name"
                  type="text"
                />
              </Field>

              <Field
                required
                invalid={!!errors.age}
                errorText={errors.age?.message}
                label="Age"
              >
                <Input
                  {...register("age", {
                    required: "Age is required.",
                  })}
                  placeholder="Age"
                  type="number"
                />
              </Field>

              <Field
                invalid={!!errors.practical_wish}
                errorText={errors.practical_wish?.message}
                label="Practical Wish"
              >
                <Input
                  {...register("practical_wish")}
                  placeholder="Practical Wish"
                  type="text"
                />
              </Field>

              <Field
                invalid={!!errors.fun_wish}
                errorText={errors.fun_wish?.message}
                label="Fun Wish"
              >
                <Input
                  {...register("fun_wish")}
                  placeholder="Fun Wish"
                  type="text"
                />
              </Field>

              <Field
                invalid={!!errors.fun_wish}
                errorText={errors.fun_wish?.message}
                label="Optional Note"
              >
                <Input
                  {...register("note")}
                  placeholder="Optional Note"
                  type="text"
                />
              </Field>
            </VStack>
          </DialogBody>

          <DialogFooter gap={2}>
            <ButtonGroup>
              <DialogActionTrigger asChild>
                <Button
                  variant="subtle"
                  colorPalette="gray"
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
              </DialogActionTrigger>
              <Button variant="solid" type="submit" loading={isSubmitting}>
                Save
              </Button>
            </ButtonGroup>
          </DialogFooter>
        </form>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  )
}

export default EditFamilyMember
