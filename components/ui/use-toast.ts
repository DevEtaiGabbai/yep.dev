// Simple toast hook implementation

export const useToast = () => {
  return {
    toast: ({ title, description, variant }: { 
      title?: string; 
      description?: string; 
      variant?: "default" | "destructive"; 
    }) => {
      console.log(`Toast: ${title} - ${description} (${variant})`);
      // For now just log the toast
      // When you implement a proper toast component, this will use it
    }
  };
}; 