"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  BadgeCheck,
  LogOut,
  Sparkles,
} from "lucide-react"
import { signOut } from "next-auth/react"
import { IoSettingsOutline } from "react-icons/io5"
import { useRouter } from "next/navigation"
import { useState } from "react"
import ModalUpdateApiKeys from "@/app/chat/ModalUpdateApiKeys"

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
    isSubscribed?: boolean
  }
}) {
  const { isMobile } = useSidebar()
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const handleSubscription = async () => {
    try {
      setIsLoading(true)
      const response = await fetch("/api/stripe/create-checkout", {
        method: "POST",
      })
      const data = await response.json()

      if (data.url) {
        router.push(data.url)
      }
    } catch (error) {
      console.error("Error creating checkout session:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenModal = () => {
    setDropdownOpen(false)
    setModalOpen(true)
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size="lg"
              >
                <IoSettingsOutline />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              side={isMobile ? "bottom" : "right"}
              align="end"
              sideOffset={4}
            >
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={handleSubscription}
                  disabled={isLoading || user.isSubscribed}
                >
                  <Sparkles />
                  {user.isSubscribed ? "Subscribed" : "Upgrade to Pro"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={handleOpenModal}>
                  <BadgeCheck />
                  Update API Keys
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut({
                callbackUrl: "/login",
                redirect: true,
              })}>
                <LogOut />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <ModalUpdateApiKeys open={modalOpen} setOpen={setModalOpen} />
    </>
  )
}
