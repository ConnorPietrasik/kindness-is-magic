import {
  Button,
  DialogActionTrigger,
  DialogTitle,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type SubmitHandler, useForm } from "react-hook-form"
import { FaPlus } from "react-icons/fa"

import { type FamilyMemberCreate, FamilyMembersService } from "@/client"
import type { ApiError } from "@/client/core/ApiError"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"
import {
  DialogBody,
  DialogCloseTrigger,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  DialogTrigger,
} from "../ui/dialog"
import { Field } from "../ui/field"

const AddFamilyMember = () => {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast } = useCustomToast()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isValid, isSubmitting },
  } = useForm<FamilyMemberCreate>({
    mode: "onBlur",
    criteriaMode: "all",
    defaultValues: {
      title: "",
      description: "",
      given_name: "",
      age: 0,
      practical_wish: "",
      fun_wish: "",
    },
  })

  const mutation = useMutation({
    mutationFn: (data: FamilyMemberCreate) =>
      FamilyMembersService.createFamilyMember({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Family Member created successfully.")
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

  const onSubmit: SubmitHandler<FamilyMemberCreate> = (data) => {
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
        <Button value="add-family_member" my={4}>
          <FaPlus fontSize="16px" />
          Add Family Member
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Add Family Member</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Text mb={4}>Fill in the details to add a new family member.</Text>
            <VStack gap={4}>
              <Field
                required
                invalid={!!errors.title}
                errorText={errors.title?.message}
                label="Title"
              >
                <Input
                  {...register("title", {
                    required: "Title is required.",
                  })}
                  placeholder="Title"
                  type="text"
                />
              </Field>

              <Field
                invalid={!!errors.description}
                errorText={errors.description?.message}
                label="Description"
              >
                <Input
                  {...register("description")}
                  placeholder="Description"
                  type="text"
                />
              </Field>

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
                  placeholder="fun Wish"
                  type="text"
                />
              </Field>
            </VStack>
          </DialogBody>

          <DialogFooter gap={2}>
            <DialogActionTrigger asChild>
              <Button
                variant="subtle"
                colorPalette="gray"
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </DialogActionTrigger>
            <Button
              variant="solid"
              type="submit"
              disabled={!isValid}
              loading={isSubmitting}
            >
              Save
            </Button>
          </DialogFooter>
        </form>
        <DialogCloseTrigger />
      </DialogContent>
    </DialogRoot>
  )
}

export default AddFamilyMember
