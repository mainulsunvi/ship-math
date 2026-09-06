import { Link } from "@shopify/polaris";

export default function ShipMathFooter() {
  return (
    <div
      style={{
        textAlign: "center",
        marginTop: "50px",
        paddingBottom: "20px",
        fontSize: "14px",
        color: "#666",
        userSelect: "none",
      }}
    >
      Built with ❤️ by{" "}
      <LinkText
        href="https://www.pixelfic.com"
        target="_blank"
        rel="noopener noreferrer"
      >
        <b>Pixelfic Inc.</b>
      </LinkText>
      &nbsp; &copy; {new Date().getFullYear()}
    </div>
  );	
}

function LinkText({ children, href, target, rel }: {
    children: React.ReactNode;
    href: string;
    target?: string;
    rel?: string;
  }) {
    return (
      <Link url={href} target={target} rel={rel} removeUnderline>
        {children}
      </Link>
    );
  }
