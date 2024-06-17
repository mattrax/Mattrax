const links = [
    {icon: IconFaBrandsGithub, href: "https://github.com/mattrax/Mattrax"},
    {icon: IconFaBrandsDiscord, href: "https://discord.gg/WPBHmDSfAn"},
]


const Social = () => {
    return (
        <div class='flex gap-3 justify-center mt-10'>
            {links.map(({icon, href}) => (
                 <a class='transition-all duration-300 hover:opacity-60' href={href} target="_blank" rel="noreferrer">
                    {icon({ width: "28px", class: 'text-[28px] text-blue-500' })}
                </a>
            ))}
        </div>
    );
};

export default Social;