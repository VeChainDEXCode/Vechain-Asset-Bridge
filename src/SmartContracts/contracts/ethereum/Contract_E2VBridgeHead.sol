pragma solidity >=0.5.16 <0.6.0;

import "../common/Interface_BridgeHead.sol";
import "../common/Interface_VIP180.sol";
import "../common/Interface_VIP211.sol";
import "../common/Library_SafeMath.sol";
import "../common/Library_Merkle.sol";
import "../common/Contract_MerkleData.sol";
import "../common/Contract_TokenRegister.sol";

contract E2VBridgeHead is IBridgeHead {
    address public verifier;
    address public governance;

    uint8 public constant FREEZE = 0;
    uint8 public constant NATIVETOKEN = 1;
    uint8 public constant WRAPPEDTOKEN = 2;

    mapping(bytes32 => bytes32) public claimed;
    mapping(address => uint8) public tokens;

    bytes32 public merkleRoot;

    event Swap(address indexed _token,address indexed _from,address indexed _to,uint256 _amount);
    event Claim(address indexed _token, address indexed _to, uint256 _amount);

    bool public locked = true;

    function name() external view returns (string) {
        return "Ethereum To VeChainThor bridge head";
    }

    // management

    function setVerifier(address _addr) external onlyGovernance {
        verifier = _addr;
    }

    function setGovernance(address _addr) external onlyGovernance {
        governance = _addr;
    }

    function setToken(address _token, uint8 _type) external onlyGovernance {
        tokens[_token] = _type;
    }

    function updateMerkleRoot(bytes32 _root) external onlyVerifier {
        require(locked != false, "the bridge isn't lock");
        merkleRoot = _root;
        locked = false;
    }

    // Bridge funtions

    function swap(
        address _token,
        uint256 _amount,
        address _to
    ) external isLock returns (bool) {
        require(
            tokens[_token] == 1 || tokens[_token] == 2,
            "token not register or freeze"
        );

        IVIP180 token181 = IVIP180(_token);
        require(
            token181.balanceOf(msg.sender) >= _amount,
            "insufficient balance"
        );
        require(
            token181.allowance(msg.sender, address(this)) >= _amount,
            "insufficient allowance"
        );

        uint256 beforeBlance = token181.balanceOf(address(this));
        require(
            token181.transferFrom(msg.sender, address(this), _amount),
            "transfer faild"
        );
        uint256 afterBalance = token181.balanceOf(address(this));
        require(
            SafeMath.sub(afterBalance, beforeBlance) == _amount,
            "balance check faild"
        );

        if (tokens[_token] == WRAPPEDTOKEN) {
            IVIP211 token211 = IVIP211(_token);
            require(
                token211.recovery(address(this), _amount),
                "wrapped token recovery faild"
            );
        }

        emit Swap(_token, msg.send, _to, _amount);
        return true;
    }

    function claim(
        address _token,
        address _to,
        uint256 _balance,
        bytes32[] calldata _merkleProof
    ) external isLock returns (bool) {
        require(
            tokenRegister[_token] == 1 || tokenRegister[_token] == 2,
            "token not register or freeze"
        );

        bytes32 nodehash = keccak256(abi.encodePacked(_to, _token, _balance));
        require(MerkleProof.verify(_merkleProof, root, leaf), "invalid proof");

        require(!isClaim(merkleRoot, nodehash), "the swap has been claimed");

        if (tokenRegister[_token] == WRAPPEDTOKEN) {
            IVIP211 token211 = IVIP211(_token);
            uint256 beforeBalance = token211.balanceOf(address(this));
            require(
                token211.mint(address(this), _balance),
                "wrapped token mint faild"
            );
            uint256 afterBalance = token211.balanceOf(address(this));
            require(
                SafeMath.sub(afterBalance, beforeBalance) == _balance,
                "balance check faild"
            );
        }

        IVIP180 token181 = IVIP180(_token);
        token181.transfer(_to, _balance);

        setClaim(merkleRoot, nodehash);

        emit Claim(_token, _to, _balance);

        return true;
    }

    function lock() external onlyVerifier {
        locked = true;
    }

    function isClaim(bytes32 _merkleroot, bytes32 nodehash)
        external
        returns (bool)
    {
        return claimed[_merkleroot] == nodehash;
    }

    function setClaim(bytes32 _merkleroot, bytes32 nodehash) private {
        return claimed[_merkleroot] == nodehash;
    }

    modifier onlyVerifier() {
        require(msg.sender == verifier, "permission denied");
        _;
    }

    modifier onlyGovernance() {
        require(msg.sender == governance, "permission denied");
        _;
    }

    modifier isLock() {
        require(locked == false, "the bridge locked");
        _;
    }
}
