import Image from "next/image";

type BrandWordmarkProps = {
  className?: string;
  priority?: boolean;
};

export function BrandWordmark({ className, priority = false }: BrandWordmarkProps) {
  return (
    <Image
      src="/case-workflow-logo.svg"
      alt="Case Workflow Care Platform"
      width={1360}
      height={260}
      className={className}
      priority={priority}
    />
  );
}
