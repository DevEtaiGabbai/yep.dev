"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Crown, Zap } from "lucide-react";
import { useRouter } from "next/navigation";

interface UpgradeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpgradeDialog({ open, onOpenChange }: UpgradeDialogProps) {
  const router = useRouter()

  const handleUpgrade = async () => {
    try {
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
      onOpenChange(false);
    }

  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-[#161618] border-[#313133] text-white">
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center">
            <Crown className="h-6 w-6 text-white" />
          </div>
          <DialogTitle className="text-xl font-semibold">
            Upgrade to Pro
          </DialogTitle>
          <DialogDescription className="text-gray-400 mt-2">
            You&apos;ve reached the limit of 5 projects for free users. Upgrade to Pro to create unlimited projects and unlock more features.
          </DialogDescription>
        </DialogHeader>

        <div className="my-6">
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span>Unlimited projects</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span>Priority support</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Zap className="h-4 w-4 text-yellow-500" />
              <span>Advanced features</span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[#313133] bg-transparent hover:bg-[#1a1a1c] text-gray-300"
          >
            Maybe Later
          </Button>
          <Button
            onClick={handleUpgrade}
            className="bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white"
          >
            Upgrade Now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
