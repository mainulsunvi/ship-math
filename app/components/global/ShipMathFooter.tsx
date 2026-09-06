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
      <LinkText href="https://www.pixelfic.com" target="_blank">
        <b>Pixelfic Inc.</b>
      </LinkText>
      &nbsp; &copy; {new Date().getFullYear()}
    </div>
  );	
}

function LinkText({ children, href, target }: {
    children: React.ReactNode;
    href: string;
    target?: "_blank" | "_self" | "_parent" | "_top";
  }) {
    return (
      <Link url={href} target={target} removeUnderline>
        {children}
      </Link>
    );
  }
